import shutil
from pathlib import Path

from langchain_core.documents import Document
from langchain_chroma import Chroma
from langchain_core.embeddings import Embeddings

ADD_BATCH_SIZE = 32


def _reset_persist_dir(persist_path: Path) -> None:
    if persist_path.exists():
        shutil.rmtree(persist_path)
    persist_path.mkdir(parents=True, exist_ok=True)


def _iter_batches(docs: list[Document], batch_size: int):
    for index in range(0, len(docs), batch_size):
        yield docs[index : index + batch_size]


def build_or_load_vectorstore(
    docs: list[Document] | None = None,
    embeddings: Embeddings | None = None,
    persist_dir: str = ".chroma",
    rebuild: bool = False,
) -> Chroma:
    """Build a new vectorstore from docs or load existing one."""

    if embeddings is None:
        raise ValueError("embeddings must be provided")

    persist_path = Path(persist_dir)
    if rebuild:
        _reset_persist_dir(persist_path)

    if persist_path.exists() and list(persist_path.iterdir()):
        print(f"Loading existing vectorstore from {persist_dir}")
        vectorstore = Chroma(
            persist_directory=str(persist_path),
            embedding_function=embeddings,
        )
    else:
        if docs is None or len(docs) == 0:
            raise ValueError("No documents provided and no existing vectorstore found")
        print(f"Building new vectorstore from {len(docs)} chunks...")
        vectorstore = Chroma(
            persist_directory=str(persist_path),
            embedding_function=embeddings,
        )
        for batch in _iter_batches(docs, ADD_BATCH_SIZE):
            vectorstore.add_documents(batch)
        print(f"Vectorstore persisted to {persist_dir}")

    return vectorstore


def get_retriever(vectorstore: Chroma, k: int = 3):
    """Get a retriever from the vectorstore."""
    return vectorstore.as_retriever(search_kwargs={"k": k})
