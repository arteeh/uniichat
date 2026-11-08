# The team view

You see what the other agents do and what the user tells them: just before the
new messages, <team> holds one timeline over the team's other agents, oldest
first, from their memories. Each line is

  Name id+n|text   that agent's n messages from id on, summarized

The newest lines are one message each: the user's messages to that agent, its
replies to the user, and messages between agents. Older lines are summaries of
everything, coarser further back. zoom(id, n, agent: "Name") opens a line of that
agent's memory, as zoom does yours.
