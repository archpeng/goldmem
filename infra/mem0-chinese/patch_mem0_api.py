from pathlib import Path

path = Path("/app/main.py")
source = path.read_text()

required = [
    "class SearchRequest(BaseModel):",
    "return MEMORY_INSTANCE.search(query=search_req.query, **params)",
]
missing = [item for item in required if item not in source]
if missing:
    raise RuntimeError(f"Mem0 API patch target changed; missing: {missing}")

if "import jieba" not in source:
    source = source.replace("import logging\n", "import logging\nimport jieba\n")

if "from pathlib import Path" not in source:
    source = source.replace("from typing import Any, Dict, List, Optional\n", "from pathlib import Path\nfrom typing import Any, Dict, List, Optional\n")

if "GOLDMEM_CHINESE_DICT" not in source:
    marker = 'HISTORY_DB_PATH = os.environ.get("HISTORY_DB_PATH", "/app/history/history.db")\n'
    source = source.replace(
        marker,
        marker
        + 'GOLDMEM_CHINESE_NLP = os.environ.get("MEM0_CHINESE_NLP", "jieba")\n'
        + 'GOLDMEM_CHINESE_DICT = os.environ.get("MEM0_CHINESE_DICT", "/app/goldmem/chinese_dict.txt")\n',
    )

if "def goldmem_expand_chinese_query" not in source:
    helper = '''

def goldmem_expand_chinese_query(query: str) -> str:
    """Add jieba tokens for Chinese keyword/entity search while preserving the original query."""
    if GOLDMEM_CHINESE_NLP != "jieba" or not any("\\u4e00" <= char <= "\\u9fff" for char in query):
        return query

    dict_path = Path(GOLDMEM_CHINESE_DICT)
    if dict_path.exists():
        jieba.load_userdict(str(dict_path))

    tokens = [
        token.strip()
        for token in jieba.lcut(query)
        if len(token.strip()) > 1 and token.strip() not in query.split()
    ]
    unique_tokens = list(dict.fromkeys(tokens))
    if not unique_tokens:
        return query
    return f"{query}\\n关键词: {' '.join(unique_tokens[:24])}"

'''
    source = source.replace("\n\nDEFAULT_CONFIG = {\n", helper + "\nDEFAULT_CONFIG = {\n")

if "limit: Optional[int] = None" not in source:
    source = source.replace(
        '    filters: Optional[Dict[str, Any]] = None\n',
        '    filters: Optional[Dict[str, Any]] = None\n'
        '    limit: Optional[int] = None\n'
        '    threshold: Optional[float] = None\n',
    )

source = source.replace(
    "return MEMORY_INSTANCE.search(query=search_req.query, **params)",
    "return MEMORY_INSTANCE.search(query=goldmem_expand_chinese_query(search_req.query), **params)",
)

path.write_text(source)
