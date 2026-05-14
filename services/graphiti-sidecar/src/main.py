import json
import os
import hashlib
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

import asyncpg
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

try:
    from graphiti_core import Graphiti
    from graphiti_core.nodes import EpisodeType
except Exception:  # pragma: no cover - surfaced by /health in misconfigured images
    Graphiti = None  # type: ignore[assignment]
    EpisodeType = None  # type: ignore[assignment]

try:
    from graphiti_core.driver.neo4j_driver import Neo4jDriver
except Exception:  # pragma: no cover - optional path used only for custom database names
    Neo4jDriver = None  # type: ignore[assignment]


class AddEpisodeRequest(BaseModel):
    name: str
    episode_body: dict[str, Any] | str
    source: str = "json"
    source_description: str = "mem curated temporal episode"
    reference_time: str
    group_id: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class SearchFactsRequest(BaseModel):
    query: str
    group_id: str
    max_facts: int | None = 10
    tenantId: str | None = None
    elderId: str | None = None
    entities: list[dict[str, Any]] | None = None
    timeRange: dict[str, Any] | None = None


class EntityTimelineRequest(BaseModel):
    group_id: str
    tenantId: str | None = None
    elderId: str | None = None
    entityName: str
    entityType: str | None = None
    limit: int | None = 10


class CurrentFactsRequest(BaseModel):
    group_id: str
    tenantId: str | None = None
    elderId: str | None = None
    entities: list[dict[str, Any]] | None = None
    predicates: list[str] | None = None
    limit: int | None = 10


graphiti_client: Any | None = None
provenance_pool: asyncpg.Pool | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global graphiti_client, provenance_pool
    graphiti_client = await build_graphiti()
    provenance_pool = await build_provenance_pool()
    if graphiti_client is not None:
        await graphiti_client.build_indices_and_constraints()
    yield
    if graphiti_client is not None:
        await graphiti_client.close()
    if provenance_pool is not None:
        await provenance_pool.close()


app = FastAPI(title="mem Graphiti Sidecar", lifespan=lifespan)


async def require_api_key(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
) -> None:
    expected = os.environ.get("GRAPHITI_API_KEY", "").strip()
    if not expected:
        return
    bearer = authorization.removeprefix("Bearer ").strip() if authorization else None
    if x_api_key != expected and bearer != expected:
        raise HTTPException(status_code=401, detail="Invalid Graphiti API key")


@app.get("/health")
async def health() -> dict[str, Any]:
    graphiti_configured = graphiti_client is not None
    provenance_configured = provenance_pool is not None
    return {
        "ok": graphiti_configured and provenance_configured,
        "graphitiConfigured": graphiti_configured,
        "provenanceStore": "postgres" if provenance_configured else "not_configured",
        "backend": "neo4j",
        "neo4jUri": os.environ.get("GRAPHITI_NEO4J_URI") or os.environ.get("NEO4J_URI") or "bolt://localhost:7687",
    }


@app.post("/add_episode", dependencies=[Depends(require_api_key)])
async def add_episode(input: AddEpisodeRequest) -> dict[str, Any]:
    if graphiti_client is None or EpisodeType is None:
        raise HTTPException(status_code=503, detail="Graphiti is not configured")
    if provenance_pool is None:
        raise HTTPException(status_code=503, detail="Graphiti provenance store is not configured")

    body = normalize_episode_body(input.episode_body, input.metadata)
    graphiti_group_id = normalize_graphiti_group_id(input.group_id)
    await graphiti_client.add_episode(
        name=input.name,
        episode_body=body,
        source=EpisodeType.json if input.source == "json" else EpisodeType.text,
        source_description=input.source_description,
        reference_time=parse_datetime(input.reference_time),
        group_id=graphiti_group_id,
    )

    await persist_provenance(input, body)
    return {"ok": True}


@app.post("/search_facts", dependencies=[Depends(require_api_key)])
async def search_facts(input: SearchFactsRequest) -> dict[str, Any]:
    if graphiti_client is None:
        raise HTTPException(status_code=503, detail="Graphiti is not configured")

    provenance = await provenance_candidates(input.group_id)
    raw_results = await search_graphiti(input)
    facts = [fact for fact in normalize_search_results(raw_results, provenance) if fact.get("sourceId")]
    provenance_facts = provenance_index_search(input, provenance)
    facts = merge_facts([*facts, *provenance_facts])

    return {
        "facts": facts[: input.max_facts or 10],
        "rawGraphitiCount": len([fact for fact in facts if fact.get("origin") == "graphiti_raw"]),
        "provenanceFallbackCount": len([fact for fact in facts if fact.get("origin") == "provenance_fallback"]),
    }


@app.post("/entity_timeline", dependencies=[Depends(require_api_key)])
async def entity_timeline(input: EntityTimelineRequest) -> dict[str, Any]:
    items = []
    needle = input.entityName.lower()
    for episode in await provenance_candidates(input.group_id):
        text = json.dumps(episode["body"], ensure_ascii=False).lower()
        if needle in text:
            metadata = episode["metadata"]
            items.append({
                "occurredAt": episode["reference_time"],
                "sourceId": first_string(metadata.get("sourceIds")),
                "eventId": first_string(metadata.get("eventIds")),
                "episodeId": episode["name"],
                "fact": extract_episode_summary(episode["body"]),
                "status": "active",
                "metadata": metadata,
            })
    return {"timeline": items[: input.limit or 10]}


@app.post("/current_facts", dependencies=[Depends(require_api_key)])
async def current_facts(input: CurrentFactsRequest) -> dict[str, Any]:
    terms = [entity.get("name", "") for entity in input.entities or [] if isinstance(entity.get("name"), str)]
    request = SearchFactsRequest(query=" ".join(terms), group_id=input.group_id, max_facts=input.limit)
    facts = provenance_index_search(request, await provenance_candidates(input.group_id))
    return {"facts": facts[: input.limit or 10]}


async def build_graphiti() -> Any | None:
    if Graphiti is None:
        return None
    uri = os.environ.get("GRAPHITI_NEO4J_URI") or os.environ.get("NEO4J_URI") or "bolt://localhost:7687"
    user = (
        os.environ.get("GRAPHITI_NEO4J_USER")
        or os.environ.get("GRAPHITI_NEO4J_USERNAME")
        or os.environ.get("NEO4J_USER")
        or os.environ.get("NEO4J_USERNAME")
        or "neo4j"
    )
    password = (
        os.environ.get("GRAPHITI_NEO4J_PASSWORD")
        or os.environ.get("NEO4J_PASSWORD")
        or "graphitimem"
    )
    database = os.environ.get("GRAPHITI_NEO4J_DATABASE")

    if database and Neo4jDriver is not None:
        driver = Neo4jDriver(uri=uri, user=user, password=password, database=database)
        return Graphiti(graph_driver=driver)

    try:
        return Graphiti(neo4j_uri=uri, neo4j_user=user, neo4j_password=password)
    except TypeError:
        return Graphiti(uri, user, password)


async def build_provenance_pool() -> asyncpg.Pool | None:
    database_url = os.environ.get("GRAPHITI_PROVENANCE_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not database_url:
        return None
    return await asyncpg.create_pool(database_url, min_size=1, max_size=int(os.environ.get("GRAPHITI_PROVENANCE_POOL_SIZE", "3")))


async def search_graphiti(input: SearchFactsRequest) -> list[Any]:
    graphiti_group_id = normalize_graphiti_group_id(input.group_id)
    try:
        return await graphiti_client.search(
            query=input.query,
            group_ids=[graphiti_group_id],
            num_results=input.max_facts or 10,
        )
    except TypeError:
        try:
            return await graphiti_client.search(input.query, group_id=graphiti_group_id)
        except TypeError:
            return await graphiti_client.search(input.query)


def normalize_episode_body(body: dict[str, Any] | str, metadata: dict[str, Any]) -> str:
    if isinstance(body, str):
        return body
    enriched = {"memMetadata": metadata, **body}
    return json.dumps(enriched, ensure_ascii=False)


def normalize_graphiti_group_id(group_id: str) -> str:
    output = []
    for char in group_id.strip():
        if char.isascii() and (char.isalnum() or char in {"-", "_"}):
            output.append(char)
        else:
            output.append(f"_{ord(char):x}_")
    return "".join(output) or "mem_unknown"


def normalize_search_results(results: list[Any], provenance: list[dict[str, Any]]) -> list[dict[str, Any]]:
    facts = []
    for item in results:
        fact_text = string_attr(item, "fact") or string_attr(item, "name") or string_attr(item, "summary") or str(item)
        metadata = metadata_for_fact(provenance, fact_text)
        facts.append({
            "id": string_attr(item, "uuid") or string_attr(item, "id"),
            "origin": "graphiti_raw",
            "fact": fact_text,
            "score": number_attr(item, "score") or 0.7,
            "entity_names": entity_names(item),
            "metadata": metadata,
            "sourceId": first_string(metadata.get("sourceIds")),
            "eventId": first_string(metadata.get("eventIds")),
            "episodeId": string_attr(item, "episode_uuid") or string_attr(item, "episodeId") or metadata.get("episodeId"),
        })
    return facts


def merge_facts(facts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    for fact in facts:
        key = ":".join([
            str(fact.get("sourceId") or ""),
            str(fact.get("eventId") or ""),
            str(fact.get("episodeId") or fact.get("id") or fact.get("fact") or ""),
        ])
        existing = by_key.get(key)
        if existing is None or fact_rank(fact) > fact_rank(existing):
            by_key[key] = fact
    return sorted(by_key.values(), key=lambda item: float(item.get("score") or 0), reverse=True)


def metadata_for_fact(candidates: list[dict[str, Any]], fact: str) -> dict[str, Any]:
    if len(candidates) == 1:
        metadata = dict(candidates[0]["metadata"])
        metadata["episodeId"] = candidates[0]["name"]
        return metadata
    best = None
    best_score = 0
    terms = tokenize(fact)
    for episode in candidates:
        score = score_text(json.dumps(episode["body"], ensure_ascii=False), terms)
        if score > best_score:
            best = episode
            best_score = score
    if not best:
        return {}
    metadata = dict(best["metadata"])
    metadata["episodeId"] = best["name"]
    return metadata


async def persist_provenance(input: AddEpisodeRequest, body: str) -> None:
    if provenance_pool is None:
        return
    metadata = input.metadata
    async with provenance_pool.acquire() as conn:
        await conn.execute(
            """
            insert into graphiti_episode_provenance (
              id, group_id, tenant_id, elder_id, episode_name, source_ids, event_ids,
              metadata_json, body_text, body_hash, reference_time
            )
            values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11)
            on conflict (episode_name) do update set
              metadata_json = excluded.metadata_json,
              body_text = excluded.body_text,
              body_hash = excluded.body_hash,
              reference_time = excluded.reference_time
            """,
            input.name,
            input.group_id,
            string_or_default(metadata.get("tenantId"), ""),
            string_or_default(metadata.get("elderId"), ""),
            input.name,
            json.dumps(metadata.get("sourceIds") or [], ensure_ascii=False),
            json.dumps(metadata.get("eventIds") or [], ensure_ascii=False),
            json.dumps(metadata, ensure_ascii=False),
            body,
            hashlib.sha256(body.encode("utf-8")).hexdigest(),
            parse_datetime(input.reference_time),
        )


async def provenance_candidates(group_id: str) -> list[dict[str, Any]]:
    if provenance_pool is None:
        return []
    async with provenance_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            select episode_name, body_text, metadata_json, reference_time
            from graphiti_episode_provenance
            where group_id = $1
            order by reference_time desc
            limit 200
            """,
            group_id,
        )
    episodes = [
        {
            "name": row["episode_name"],
            "body": row["body_text"],
            "metadata": json_record(row["metadata_json"]),
            "reference_time": row["reference_time"].isoformat(),
        }
        for row in rows
    ]
    return episodes


def provenance_index_search(input: SearchFactsRequest, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    terms = tokenize(input.query)
    output = []
    for episode in candidates:
        body_text = json.dumps(episode["body"], ensure_ascii=False)
        score = score_text(body_text, terms)
        if score <= 0:
            continue
        metadata = episode["metadata"]
        output.append({
            "id": episode["name"],
            "origin": "provenance_fallback",
            "fact": extract_episode_summary(episode["body"]),
            "score": min(1, 0.55 + score * 0.08),
            "entity_names": list(entity_terms(metadata, body_text)),
            "metadata": metadata,
            "sourceId": first_string(metadata.get("sourceIds")),
            "eventId": first_string(metadata.get("eventIds")),
            "episodeId": episode["name"],
            "reason": "Matched Graphiti episode provenance index.",
        })
    return sorted(output, key=lambda item: item["score"], reverse=True)


def fact_rank(fact: dict[str, Any]) -> tuple[int, float]:
    origin_priority = 1 if fact.get("origin") == "graphiti_raw" else 0
    return (origin_priority, float(fact.get("score") or 0))


def parse_datetime(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=f"Invalid datetime: {value}") from error


def tokenize(value: str) -> set[str]:
    terms: set[str] = set()
    for part in "".join(char if char.isalnum() else " " for char in value.lower()).split():
        if len(part) >= 2:
            terms.add(part)
        if contains_cjk(part):
            for size in (2, 3):
                for index in range(0, max(0, len(part) - size + 1)):
                    terms.add(part[index:index + size])
    return terms


def contains_cjk(value: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in value)


def score_text(text: str, terms: set[str]) -> int:
    lowered = text.lower()
    return sum(1 for term in terms if term in lowered)


def extract_episode_summary(body: Any) -> str:
    parsed = parse_json_body(body)
    if isinstance(parsed, dict):
        parts = []
        for event in parsed.get("events", []) or []:
            if isinstance(event, dict):
                title = event.get("title")
                summary = event.get("summary")
                if isinstance(title, str) and title:
                    parts.append(title)
                if isinstance(summary, str) and summary:
                    parts.append(summary)
        source = parsed.get("source")
        if isinstance(source, dict) and isinstance(source.get("transcript"), str):
            parts.append(source["transcript"])
        if parts:
            return " ".join(parts)[:800]

    text = body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)
    return text[:800]


def parse_json_body(body: Any) -> Any:
    if not isinstance(body, str):
        return body
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return body


def entity_terms(metadata: dict[str, Any], text: str) -> set[str]:
    values = set()
    for item in metadata.get("eventTypes", []) or []:
        if isinstance(item, str):
            values.add(item)
    for term in tokenize(text):
        if len(term) >= 3:
            values.add(term)
    return set(list(values)[:12])


def first_string(value: Any) -> str | None:
    if isinstance(value, list):
        for item in value:
            if isinstance(item, str) and item:
                return item
    return value if isinstance(value, str) and value else None


def string_or_default(value: Any, default: str) -> str:
    return value if isinstance(value, str) and value else default


def json_record(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    return {}


def string_attr(item: Any, name: str) -> str | None:
    value = getattr(item, name, None)
    return value if isinstance(value, str) and value else None


def number_attr(item: Any, name: str) -> float | None:
    value = getattr(item, name, None)
    return value if isinstance(value, (int, float)) else None


def entity_names(item: Any) -> list[str]:
    for attr in ["entity_names", "entityNames"]:
        value = getattr(item, attr, None)
        if isinstance(value, list):
            return [entry for entry in value if isinstance(entry, str)]
    return []
