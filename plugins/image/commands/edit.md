---
name: edit
description: Edit an existing image with a natural-language instruction, optionally guided by a reference image
allowed-tools:  AskUserQuestion, Bash, Read, Glob, Grep
---

Read `${CLAUDE_PLUGIN_ROOT}/skills/image-providers/SKILL.md` before the first step; it holds the reference this command follows.

<role>
  <identity>Image Editing Command</identity>
  <mission>
    Parse the edit request, validate the files, confirm the chosen model is ready and
    supports input images, run `src/main.ts --edit` once, and report the result. No
    subagent is involved.
  </mission>
</role>

<user_request>
  $ARGUMENTS
</user_request>

<orchestration>
  <allowed_tools>AskUserQuestion, Bash, Read, Glob, Grep</allowed_tools>
  <forbidden_tools>Write, Edit, Agent</forbidden_tools>

  <phases>
    <phase number="1" name="Input Validation">
      <objective>Validate and quote the edit request</objective>
      <steps>
        <step>Extract the source image path (first positional) and the quoted instruction</step>
        <step>The instruction must be non-empty; quote it with single quotes, escaping embedded ones as '\''</step>
        <step>Parse --ref (repeatable), --model, --aspect, --max-retries</step>
        <step>Output path: `{source-stem}_edited.png` beside the source, unless one is given</step>
      </steps>
      <quality_gate>
        Source path and instruction extracted and quoted. Output path determined.
      </quality_gate>
    </phase>

    <phase number="2" name="Pre-Flight">
      <objective>Confirm files and model</objective>
      <steps>
        <step>Verify the source image exists; verify every --ref file exists</step>
        <step>Run `bun "${CLAUDE_PLUGIN_ROOT}/src/main.ts" --models`; the chosen model's line
          must read `ready`. The CLI itself refuses `--edit`/`--ref` on a model without
          input-image support and names the ones that have it; relay that message if it appears.</step>
      </steps>
      <quality_gate>
        Source and references exist. The chosen model reads `ready`.
      </quality_gate>
    </phase>

    <phase number="3" name="Edit">
      <objective>Run the single edit call</objective>
      <steps>
        <step>
          ```bash
          bun "${CLAUDE_PLUGIN_ROOT}/src/main.ts" {output} '{instruction}' --edit {source} \
            [--ref {path}]... [--model {alias}] [--aspect {ratio}] [--max-retries {n}]
          ```
        </step>
        <step>Capture stdout, stderr and the exit code. The CLI may write a different
          extension than requested when the provider returns other bytes; it prints a note
          naming the file it wrote. Report that file.</step>
      </steps>
      <quality_gate>
        The call returned; its output and exit code are captured.
      </quality_gate>
    </phase>

    <phase number="4" name="Present Results">
      <objective>Report the outcome</objective>
      <steps>
        <step>Show source and output paths</step>
        <step>Report any error with the CLI's text</step>
        <step>Repeat any freshness advisory verbatim</step>
        <step>Suggest a further edit on the output</step>
      </steps>
      <quality_gate>
        User sees before and after paths, or the exact failure.
      </quality_gate>
    </phase>
  </phases>

  <error_recovery>
    <strategy name="source_not_found">
      Report "Source image not found: {path}" and list image files in that directory.
    </strategy>
    <strategy name="model_not_ready">
      Stop before the call; name the variable `--models` reports and any model already `ready`.
    </strategy>
    <strategy name="edit_unsupported">
      Relay the CLI's message listing the models that accept input images; ask which to use.
    </strategy>
    <strategy name="content_policy">
      Report the block and a rephrasing that would likely pass; do not retry unasked.
    </strategy>
  </error_recovery>
</orchestration>

<examples>
  <example name="Simple edit">
    <input>/image:edit photo.jpg "Add sunset colors to the sky"</input>
    <flow>
      1. Parse: source=photo.jpg, instruction='Add sunset colors to the sky'
      2. Verify photo.jpg exists; `--models` shows the default model `ready`
      3. `bun "${CLAUDE_PLUGIN_ROOT}/src/main.ts" photo_edited.png 'Add sunset colors to the sky' --edit photo.jpg`
      4. Report photo.jpg -> photo_edited.png
    </flow>
  </example>

  <example name="With reference">
    <input>/image:edit logo.png "Match this style" --ref style.png --model gpt-image</input>
    <flow>
      1. Parse: source=logo.png, instruction, ref=style.png, model=gpt-image
      2. Verify both files; `--models` shows gpt-image `ready`
      3. `bun "${CLAUDE_PLUGIN_ROOT}/src/main.ts" logo_edited.png 'Match this style' --edit logo.png --ref style.png --model gpt-image`
    </flow>
  </example>
</examples>
