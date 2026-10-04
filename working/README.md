# working/

Scratch space for trying the connector end to end. Nothing in here is used by the Worker, tests or build; the main project files are untouched.

## battery-level.jelly

Test prompt: "make me a shortcut that tells me my battery level."

Tool calls, in order:
1. `jelly_guide` (all)
2. `search_actions` "battery level" → `batteryLevel` (built-in, no params)
3. `get_action` `batteryLevel`, `showResult`
4. `validate_jelly` → no errors
5. `share_jelly` name "Battery Level" → install link:
   https://jellycuts-mcp.gpcsogaming.workers.dev/s/Battery-Level#v1.PY09C8JAEET_yrJRSCCQ_ooUWglWsRK2OS-LCZx7crfxg5D_LknUdubNmxEFDe6sKsc3HPnBHkt0aLC_3UNUOHUhqhs0kWT74EM0cI3MUkJ2cEEMXNYtCUlVQcO2Be34F4OflWClhdSFJ_RK8q2Ws7yAul4hkploOA1ec-WXGiA8hyH-XX0Cq7AZF3zaEhYkOH0A
