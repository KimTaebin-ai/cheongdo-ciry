"""Stage 1 smoke test for the Agent Framework GitHub Copilot provider."""

from __future__ import annotations

import asyncio
import os

from agent_framework.github import GitHubCopilotAgent
from copilot.session import PermissionHandler


def dummy_tool(value: str) -> str:
    """Return a deterministic result so tool invocation is observable."""
    result = f"DUMMY_TOOL_SUCCESS:{value}"
    print(result)
    return result


async def main() -> None:
    agent = GitHubCopilotAgent(
        instructions=(
            "You are a Korean smoke-test agent. Reply briefly in Korean. "
            "For this request, call dummy_tool exactly once with the value 'hello', "
            "then greet the user and include the tool result."
        ),
        tools=[dummy_tool],
        default_options={
            "model": os.getenv("GITHUB_COPILOT_MODEL", "gpt-5"),
            "timeout": 60,
            "on_permission_request": PermissionHandler.approve_all,
        },
    )

    async with agent:
        result = await agent.run("안녕")
        print(str(result))


if __name__ == "__main__":
    asyncio.run(main())
