from pathlib import Path
from langchain_community.document_loaders import DirectoryLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document


def load_and_chunk_wiki(wiki_dir: str) -> list[Document]:
    """Load all markdown files from wiki_dir and split into chunks."""
    wiki_path = Path(wiki_dir)
    if not wiki_path.exists():
        raise FileNotFoundError(f"Wiki directory not found: {wiki_dir}")

    loader = DirectoryLoader(
        path=str(wiki_path),
        glob="**/*.md",
        loader_cls=TextLoader,
        loader_kwargs={"autodetect_encoding": True},
        show_progress=True,
    )

    docs = loader.load()
    if not docs:
        raise ValueError(f"No markdown files found in {wiki_dir}")

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=50,
        separators=["\n\n", "\n", " ", ""],
    )

    chunks = splitter.split_documents(docs)
    print(f"Loaded {len(docs)} files and created {len(chunks)} chunks")
    return chunks
