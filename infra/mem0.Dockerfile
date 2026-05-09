FROM mem0/mem0-api-server:latest

RUN pip install --no-cache-dir \
  "psycopg[binary,pool]" \
  psycopg2-binary \
  langchain-neo4j \
  neo4j \
  rank-bm25

RUN python - <<'PY'
from pathlib import Path

path = Path("/app/main.py")
source = path.read_text()
source = source.replace(
    '"llm": {"provider": "openai", "config": {"api_key": OPENAI_API_KEY, "temperature": 0.2, "model": "gpt-4o"}},',
    '"llm": {"provider": "openai", "config": {"api_key": OPENAI_API_KEY, "temperature": 0.2, "model": os.environ.get("MEM0_DEFAULT_LLM_MODEL", "gpt-5.5"), "openai_base_url": os.environ.get("OPENAI_BASE_URL")}},',
)
source = source.replace(
    '"embedder": {"provider": "openai", "config": {"api_key": OPENAI_API_KEY, "model": "text-embedding-3-small"}},',
    '"embedder": {"provider": "openai", "config": {"api_key": OPENAI_API_KEY, "model": os.environ.get("MEM0_DEFAULT_EMBEDDER_MODEL", "text-embedding-3-small"), "openai_base_url": os.environ.get("OPENAI_BASE_URL")}},',
)
source = source.replace(
    'class MemoryCreate(BaseModel):\n    messages: List[Message] = Field(..., description="List of messages to store.")',
    'class MemoryCreate(BaseModel):\n    messages: List[Message] = Field(..., description="List of messages to store.")\n    infer: Optional[bool] = Field(default=True, description="Whether Mem0 should infer facts from messages.")',
)
path.write_text(source)
PY
