# LangChain Basics

LangChain is a framework for developing applications powered by language models. It enables applications that are:

- **Data-aware**: connect a language model to other sources of data
- **Agentic**: allow a language model to interact with its environment

## Core Concepts

### Chains
A chain in LangChain is a sequence of calls to components (usually LLMs). Chains allow you to compose multiple components into a pipeline. For example, you might have a chain that takes user input, formats it into a prompt, passes the prompt to an LLM, and then parses the output.

### Retrieval Augmented Generation (RAG)
RAG is a technique that combines retrieval and generation. The system retrieves relevant documents from a knowledge base and uses them to augment the prompt to the language model. This approach helps the LLM produce more accurate and contextually relevant responses.

### Embeddings
Embeddings are numerical representations of text. They capture semantic meaning, allowing you to find similar pieces of text. Embeddings are crucial for RAG systems because they enable semantic search of your knowledge base.

### Vector Databases
Vector databases like Chroma, Pinecone, or Weaviate store embeddings and allow fast similarity search. They're essential for building scalable RAG systems.

## Getting Started

To get started with LangChain, you'll need:
1. Python 3.8 or higher
2. The langchain package from pip
3. An LLM provider (OpenAI, local models via Ollama, etc.)
4. Optional: a vector database for RAG applications
