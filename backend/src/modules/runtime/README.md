# Runtime module

The workflow execution engine (ADR-003, ADR-006).

Core abstraction: `execute(node, context) -> result`.

Each node type has its own executor:
- SendMessageExecutor
- AskInputExecutor
- ConditionExecutor
- SetVariableExecutor
- WaitExecutor
- EndExecutor

The engine is stateful and event-driven: when a workflow reaches a WAIT/input
node it persists conversation state and stops. The next inbound WhatsApp message
resumes execution from the saved node.

The runtime must NOT know that WhatsApp exists — it talks to the messaging
adapter only.

Implemented in Phase 4. No HTTP routes here — it's internal engine code.
