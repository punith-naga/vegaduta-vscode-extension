# Review your changes, write the commit message

VegaDuta can read your uncommitted changes (staged and unstaged) through
VS Code's built-in Git support and help before you commit.

- **VegaDuta: Review My Changes** asks for a review of the diff: bugs, risky
  changes, missing tests. It is in the command palette, the editor
  right-click menu and the Source Control view's **...** menu.
- The **sparkle button** in the Source Control title bar runs
  **VegaDuta: Generate Commit Message**. Choose *Use as commit message* on
  the answer and it is written into the message box. VegaDuta never commits;
  you do.
- On a red or yellow squiggle, open the lightbulb (`Ctrl+.` / `Cmd+.`) and
  choose **VegaDuta: Explain this problem**.

All three work signed out with an on-device model, and signed in with your
workspace's agent. New files git is not tracking yet are listed by name only;
`git add` them to include their contents.
