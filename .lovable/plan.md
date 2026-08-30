# Chats scroll diagnosis — next step

The code read is done and reported in chat. Static reading finds exactly ONE vertical
scroller in the /app/chat tree (the document). That cannot by itself produce the measured
"143px then a 1061px jump" signature, so the remaining candidates are runtime-only and need
one on-device measurement before any code changes.

## Proposed next step (read-only, no app changes shipped)

Add a temporary, dev-only diagnostic that runs on /app/chat and reports:

1. `document.scrollingElement.scrollHeight/clientHeight` and the same for `document.body`
   and for `[data-app-shell]`, sampled on every `scroll` event.
2. Which element fires the `scroll` event (`e.target`) during the slow phase vs the jump.
3. The computed `overflow-x`/`overflow-y` actually resolved on `html`, `body`,
   `[data-app-shell]`, `main` in the Android WebView (Chromium may blockify
   `overflow-x: clip` differently than desktop).
4. `visualViewport.height` / `offsetTop` samples during the drag, to rule out the visual
   viewport moving instead of the document.

Output goes to the existing `/app/diag` screen, gated to that route only. Nothing in the
chat, call, wallet or miniapp paths is touched.

## Then

Once the sampling names the element with the ~143px range, fix that one element. No
speculative changes to `src/styles.css`, the shell, or the chat list before that.
