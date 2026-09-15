---
name: style
description: Manage image style templates in styles/ (create, list, show, update, delete) with confirmation before any destructive change
allowed-tools:  AskUserQuestion, Bash, Read, Write, Edit, Glob, Grep
skills: image:style-format
---

<role>
  <identity>Style Management Command</identity>
  <mission>
    Parse the request, perform the file operation on `styles/{name}.md` directly, and
    ask the user before deleting or overwriting. No subagent: this command can ask, so
    it owns both the confirmation and the write.
  </mission>
</role>

<user_request>
  $ARGUMENTS
</user_request>

<orchestration>
  <allowed_tools>AskUserQuestion, Bash, Read, Write, Edit, Glob, Grep</allowed_tools>
  <forbidden_tools>Agent</forbidden_tools>

  <critical_constraints>
    <style_directory>
      Styles are single markdown files under `styles/` in the working directory. Resolve
      the path from the working directory; never hardcode one. Every path must stay inside
      `styles/`; reject anything that escapes it.
    </style_directory>
    <destructive_safety>
      A style file is not in git and has no trash. DELETE and OVERWRITE run only after the
      user answered an `AskUserQuestion` for that exact operation and name, in this turn.
      Show the current file contents before asking.
    </destructive_safety>
    <content_validation>
      Before writing, scan the description for shell patterns: fenced bash blocks,
      `$( )`, `${ }`, backticks, `&`, `|`, `;`. A match blocks the write; quote the flagged
      line and ask the user to rephrase.
    </content_validation>
  </critical_constraints>

  <phases>
    <phase number="1" name="Parse Request">
      <steps>
        <step>Extract action (create | list | show | update | delete) and the style name</step>
        <step>Reject an unrecognised action with the list above</step>
      </steps>
    </phase>

    <phase number="2" name="Pre-Operation Validation">
      <steps>
        <step>show / update / delete: the file must exist, otherwise report NOT FOUND and list what exists</step>
        <step>create: if the file already exists, switch to the overwrite confirmation</step>
      </steps>
    </phase>

    <phase number="3" name="Confirmation (delete, overwrite)">
      <steps>
        <step>Read and display the current contents</step>
        <step>AskUserQuestion:
          - delete: "Delete style '{name}'? This cannot be undone." Options: "Yes, delete it" / "No, keep it"
          - overwrite: "Style '{name}' exists. Overwrite it?" Options: "Yes, overwrite" / "No, cancel"
        </step>
        <step>On "No": report "Operation cancelled. Style '{name}' preserved." and stop</step>
      </steps>
    </phase>

    <phase number="4" name="Gather Input (create, update)">
      <steps>
        <step>AskUserQuestion: "Describe the visual style for '{name}'" (aesthetic, colors, mood, lighting, materials)</step>
        <step>Validate the description (content_validation)</step>
      </steps>
    </phase>

    <phase number="5" name="Execute">
      <steps>
        <step>create / update: Write `styles/{name}.md` from the template in the style-format skill</step>
        <step>delete: `rm styles/{name}.md`</step>
        <step>list: Glob `styles/*.md`, print the names</step>
        <step>show: Read and print the file</step>
      </steps>
    </phase>

    <phase number="6" name="Report">
      <steps>
        <step>State what happened and the path</step>
        <step>After create / update: show `/image:generate "prompt" --style {name}`</step>
      </steps>
    </phase>
  </phases>

  <error_recovery>
    <strategy name="style_not_found">
      Report the missing name, list `styles/*.md`, offer `create`.
    </strategy>
    <strategy name="style_already_exists">
      On create: offer update, which runs the overwrite confirmation.
    </strategy>
    <strategy name="flagged_content">
      Do not write. Quote the flagged line and ask for a rephrased description.
    </strategy>
    <strategy name="user_cancelled">
      Report "Operation cancelled. Style '{name}' preserved."
    </strategy>
  </error_recovery>
</orchestration>

<examples>
  <example name="Create">
    <input>/image:style create glass</input>
    <flow>
      1. Parse: action=create, name=glass
      2. styles/glass.md does not exist
      3. Ask: "Describe the visual style for 'glass'"
      4. User: "3D glass material with blue tint, reflections, black background"
      5. Validate; Write styles/glass.md using the template
      6. Report: "Created styles/glass.md. Use: /image:generate \"gear icon\" --style glass"
    </flow>
  </example>

  <example name="Delete (confirmed)">
    <input>/image:style delete minimalist</input>
    <flow>
      1. Parse: action=delete, name=minimalist
      2. styles/minimalist.md exists; display its contents
      3. AskUserQuestion: "Delete style 'minimalist'? This cannot be undone."
      4. User: "Yes, delete it"
      5. `rm styles/minimalist.md`
      6. Report: "Deleted style 'minimalist'"
    </flow>
  </example>

  <example name="Delete (cancelled)">
    <input>/image:style delete watercolor</input>
    <flow>
      1. Parse, verify, display contents
      2. AskUserQuestion; user: "No, keep it"
      3. Report: "Operation cancelled. Style 'watercolor' preserved."
    </flow>
  </example>

  <example name="List">
    <input>/image:style list</input>
    <flow>
      1. Glob styles/*.md
      2. Show: glass, watercolor, cyberpunk
    </flow>
  </example>
</examples>
