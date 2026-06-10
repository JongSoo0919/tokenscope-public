from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough
from langchain_core.language_models.chat_models import BaseChatModel


def format_docs(docs):
    """Format retrieved documents into a string."""
    return "\n\n".join(doc.page_content for doc in docs)


def _prompt_for_language(language: str) -> PromptTemplate:
    if language == "ko":
        template = """제공된 맥락만을 바탕으로 질문에 답하세요.
맥락에 답이 없으면 모른다고 한국어로 답하세요.

맥락:
{context}

질문: {question}

답변:"""
    else:
        template = """You are a helpful assistant answering questions based on the provided context.
If the context does not contain the answer, say you do not know.

Context:
{context}

Question: {question}

Answer:"""

    return PromptTemplate(
        template=template,
        input_variables=["context", "question"],
    )


def build_rag_chain(
    retriever, llm: BaseChatModel, response_language: str = "ko"
):
    """Build the RAG chain: retriever -> prompt -> llm -> output."""

    prompt = _prompt_for_language(response_language)

    chain = (
        {
            "context": retriever | format_docs,
            "question": RunnablePassthrough(),
        }
        | prompt
        | llm
        | StrOutputParser()
    )

    return chain, retriever


def build_prompt_coach_chain(retriever, llm: BaseChatModel):
    """Build a RAG chain that rewrites user prompts using prompt-coach knowledge."""

    prompt = PromptTemplate(
        template="""당신은 AI 코딩 세션과 토큰 사용을 개선하는 한국어 프롬프트 코치입니다.
아래 코칭 지식만 근거로 사용자의 질문 습관을 진단하고, 다음에 더 잘 물어볼 문장을 제안하세요.
근거에 없는 내용을 과장하지 말고, 사용자의 목적은 보존하세요.
반드시 한국어로만 답하세요. 영어 문장, 영어 제목, 영어 설명을 쓰지 마세요.
코드 식별자나 파일명처럼 번역하면 안 되는 짧은 고유명사만 원문을 유지할 수 있습니다.

코칭 지식:
{context}

분석할 입력:
{question}

반드시 아래 형식으로 답하세요.

요약:
<현재 질문 또는 세션 의도 한 문장>

왜 모호한가:
- <대상, 범위, 완료 조건, 제외 조건 중 부족한 점>
- <이 모호함이 탐색/반복/도구 호출을 늘리는 이유>

다음에는 이렇게 질문하세요:
<사용자가 그대로 복사해 쓸 수 있는 개선 질문>

개선된 점:
- <개선 질문이 원래 질문보다 구체적인 점>
- <작업 범위나 검증 기준이 더 명확해진 점>

토큰 절약 포인트:
- <왜 이 질문이 더 적은 탐색/반복을 만드는지>
- 예상 절약: <TokenScope 예상 절약 토큰이 있으면 그 값을 사용하고, 없으면 보수적인 범위를 한국어로 제시>
""",
        input_variables=["context", "question"],
    )

    chain = (
        {
            "context": retriever | format_docs,
            "question": RunnablePassthrough(),
        }
        | prompt
        | llm
        | StrOutputParser()
    )

    return chain, retriever
