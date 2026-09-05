import json, os, pathlib, sys
home = pathlib.Path(os.environ['HOME'])
args = sys.argv[1:]
name = pathlib.Path(sys.argv[0]).name
with (home / 'calls.jsonl').open('a') as file:
    file.write(json.dumps([name] + args) + '\n')
if (home / 'fail-provider').exists():
    print('simulated provider failure', file=sys.stderr)
    sys.exit(19)
if name == 'gh':
    endpoint = args[1]
    if '/commits?' in endpoint:
        print(json.dumps([{'sha': 'b' * 40}]))
    elif '/git/trees/' in endpoint:
        print(json.dumps({'tree': [{'path':'skills/remote/SKILL.md','type':'blob','mode':'100644'}, {'path':'skills/remote/scripts/run.sh','type':'blob','mode':'100755'}]}))
    elif '/contents/skills/remote/SKILL.md' in endpoint:
        print('---\nname: remote\ndescription: A complete remote skill directory used for verification.\n---\n# Remote')
    elif '/contents/skills/remote/scripts/run.sh' in endpoint:
        print('#!/bin/sh\necho remote')
    else:
        print('unknown endpoint', file=sys.stderr)
        sys.exit(1)
    sys.exit(0)
if name == 'claude' and args[0] == 'mcp':
    path = home / '.claude.json'
    config = json.loads(path.read_text()) if path.exists() else {'runtimeState': {'keep': True}}
    servers = config.setdefault('mcpServers', {})
    if args[1] == 'add-json':
        servers[args[2]] = json.loads(args[3])
    elif args[1] == 'remove':
        servers.pop(args[2], None)
    else:
        sys.exit(2)
    path.write_text(json.dumps(config))
print('{}')
