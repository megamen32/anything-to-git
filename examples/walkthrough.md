# End-to-end agent sequence

```text
1. Read skills/site-sync/SKILL.md.
2. a2g status
3. a2g fetch-spec -o .a2g/fetch-spec.json
4. Use any available browser to fill every declared field in
   .a2g/capture.latest.json. Optional absence is {"present": false}.
5. a2g fetch --capture .a2g/capture.latest.json
6. a2g merge
7. Resolve only explicit conflicts; ask the user when ambiguous.
8. Commit the merged site/ tree.
9. Repeat the complete fetch immediately before push.
10. a2g push-plan -o .a2g/push-plan.json
11. a2g verification-template -o .a2g/capture.after-push.json
12. Execute operations with expected-value preconditions.
13. Preserve the verification object and refetch every declared field into the
    generated post-write capture.
14. a2g verify --capture .a2g/capture.after-push.json
```

The adapter never embeds tool calls. BrowserOS, Chrome MCP, Playwright, or an
agent's built-in browser may execute the same fetch specification and push plan.
