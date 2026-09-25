#!/usr/bin/env python3
"""Apply one named mutation to CallOverlay.tsx. Exit 1 if its anchor is absent.

Kept in its own file rather than inlined in the shell driver: a python heredoc
nested inside a shell heredoc terminated the outer one early once in this repo
and left the tree mutated while `bash -n` reported clean syntax.
"""
import io
import sys

TARGET = "src/components/chat/CallOverlay.tsx"

GUARD = (
    '    const ch = channelRef.current;\n'
    '    if (!ch) {\n'
    '      sigTallyRef.current.sendsDropped += 1;\n'
    '      return;\n'
    '    }\n'
    '    if (event === "hello") sigTallyRef.current.helloTx += 1;\n'
)

MUTATIONS = {
    # The original defect, restored verbatim: count the hello, then discover
    # there is nowhere to send it.
    "M1": (
        GUARD,
        '    if (event === "hello") sigTallyRef.current.helloTx += 1;\n'
        '    const ch = channelRef.current;\n'
        '    if (!ch) {\n'
        '      sigTallyRef.current.sendsDropped += 1;\n'
        '      return;\n'
        '    }\n',
    ),
    # The silent optional-call form comes back.
    "M2": (
        GUARD,
        '    const ch = channelRef.current;\n'
        '    if (event === "hello") sigTallyRef.current.helloTx += 1;\n'
        '    void ch;\n'
        '    channelRef.current?.send({ type: "broadcast", event, payload: {} });\n'
        '    if (false) {\n',
    ),
    "M3": ("      sigTallyRef.current.sendsDropped += 1;\n", ""),
    "M4": ('if (res !== "ok") sigTallyRef.current.sendsFailed += 1;', "void res;"),
    "M5": ("  const meId = resolvedMeId;", "  const meId = meIdProp;"),
    "M6": ("          hasChannel: !!channelRef.current,\n", ""),
    "M7": ("          haveMeId: !!meId,\n", ""),
}


def main() -> int:
    name = sys.argv[1]
    old, new = MUTATIONS[name]
    src = io.open(TARGET, encoding="utf-8").read()
    if old not in src:
        return 1
    io.open(TARGET, "w", encoding="utf-8").write(src.replace(old, new, 1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
