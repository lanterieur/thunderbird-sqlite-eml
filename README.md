# thunderbird-sqlite-eml
Exports emails from thunderbird global-messages-db.sqlite as eml files in folder architecture

## Why?
We had an employee require computer reinstall. Her profile was not properly backed. No version of Thunderbird from 48 to 60 could import her emails (local folder) properly.

## Prerequisite
- Find your thunderbird profiles (on windows: %appdata%\Thunderbird\profiles\[profile name])
- Find your global-messages-db.sqlite. Normally inside your [profile name] folder
### Two options
- Export all tables as js with a tool (I used DB browser for sqlite)
- Mess with a sqlite3 module for node.

## How to use
`node index.js`

## What happens?
1. The scripts first replicates Thunderbird's folders as a tree of directories in the `output` directory.
2. The scripts sorts all messages chronologically, parses in order, creates eml, saves in folder.

## Flaws
This is a quick and dirty fix to get an employee back to work. There are many parts which can be improved:
- opening sqlite directly
- selecting user
- selecting charset (utf-8 here)
- conversation flow and replies line. I made every message in a conversation be a reply to the previous message.
