import os
from typing import Any

from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import Field


class CursorChatModel(BaseChatModel):
    """LangChain adapter for the Cursor Agent API."""

    api_key: str
    model: str
    cwd: str = Field(default_factory=os.getcwd)

    @property
    def _llm_type(self) -> str:
        return "cursor"

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        try:
            from cursor_sdk import Agent, AgentOptions, LocalAgentOptions
        except ImportError as exc:
            raise ImportError(
                "cursor-sdk is required when LLM_PROVIDER=cursor. "
                "Install it with: pip install cursor-sdk"
            ) from exc

        prompt = self._messages_to_prompt(messages)
        result = Agent.prompt(
            prompt,
            AgentOptions(
                api_key=self.api_key,
                model=self.model,
                local=LocalAgentOptions(cwd=self.cwd),
            ),
        )

        if result.status == "error":
            raise RuntimeError(f"Cursor agent run failed (run id: {result.id})")

        text = result.result or ""
        message = AIMessage(content=text)
        return ChatResult(generations=[ChatGeneration(message=message)])

    def _messages_to_prompt(self, messages: list[BaseMessage]) -> str:
        parts = []
        for message in messages:
            role = message.type
            content = message.content
            if isinstance(content, list):
                content = "\n".join(str(block) for block in content)
            parts.append(f"{role}: {content}")
        return "\n\n".join(parts)
