import os

# 단위 테스트에서는 MCP 서버를 띄우지 않는다. MCP 테스트는 test_mcp.py에서 명시적으로 켠다.
os.environ.setdefault("MCP_ENABLED", "0")
