---
name: generate
description: Generate images from text prompts with optional styles, reference images and aspect ratios
allowed-tools:  AskUserQuestion, Bash, Read, Glob, Grep
---

Read `${CLAUDE_PLUGIN_ROOT}/skills/image-providers/SKILL.md` before the first step; it holds the reference this command follows.

<role>
  <identity>Image Generation Command</identity>
  <mission>
    Parse the arguments, validate and quote every input, confirm the chosen model is
    ready, run `src/main.ts` once, and report what was produced. There is no
    subagent: this command makes the call itself.
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
      <objective>Validate and quote all user inputs</objective>
      <steps>
        <step>Extract quoted prompts from $ARGUMENTS; each must be non-empty</step>
        <step>Quote every prompt with single quotes for bash; escape embedded single quotes as '\''</step>
        <step>Parse --style (resolve `glass` to `styles/glass.md`; a path passes through)</step>
        <step>Parse --aspect; `bun "${CLAUDE_PLUGIN_ROOT}/src/main.ts" --help` lists the valid set</step>
        <step>Parse --model (alias or full ID); parse --ref (repeatable)</step>
        <step>Determine output path (default: generated/{slug-of-first-prompt}.png)</step>
      </steps>
      <quality_gate>
        Every prompt is non-empty and quoted. Style path exists if given. Aspect is valid.
      </quality_gate>
    </phase>

    <phase number="2" name="Pre-Flight">
      <objective>Confirm the environment can run the call</objective>
      <steps>
        <step>Run `bun "${CLAUDE_PLUGIN_ROOT}/src/main.ts" --models`. Each pinned model prints
          `ready (VAR set)` or `set VAR to enable`. The chosen model (default when --model is
          omitted: the line marked as default in `--help`) must read `ready`; otherwise stop
          and report the variable it names. Never check one provider's key by hand: the
          registry knows which variables each model accepts.</step>
        <step>If --style, verify the file exists and contains no shell patterns
          (`$( )`, `${ }`, backticks, `&`, `|`, `;`); a match aborts with the flagged line quoted</step>
        <step>If --ref, verify each reference image exists</step>
        <step>If the output directory does not exist, `mkdir -p` it</step>
      </steps>
      <quality_gate>
        The chosen model reads `ready`. All referenced files exist. Output directory exists.
      </quality_gate>
    </phase>

    <phase number="3" name="Generate">
      <objective>Run the single generation call</objective>
      <steps>
        <step>Build and run one command:
          ```bash
          bun "${CLAUDE_PLUGIN_ROOT}/src/main.ts" {output} {'prompt'...} \
            [--style {path}] [--ref {path}]... [--aspect {ratio}] [--model {alias}] [--max-retries {n}]
          ```
          Several prompts in one call are a batch: the CLI writes `{output}_001.png`,
          `{output}_002.png`, and so on.</step>
        <step>Capture stdout, stderr and the exit code. The CLI prints
          `Completed: N/M images`, then a `Failed images:` list when any prompt failed,
          then an optional freshness advisory.</step>
      </steps>
      <quality_gate>
        The call returned; its exit code and output are captured.
      </quality_gate>
    </phase>

    <phase number="4" name="Present Results">
      <objective>Report the outcome</objective>
      <steps>
        <step>List every generated file path with its prompt</step>
        <step>Report failures per prompt with the CLI's error text</step>
        <step>Repeat any freshness advisory the CLI printed, verbatim</step>
        <step>Suggest a follow-up: `/image:edit` on the result, or more prompts for variations</step>
      </steps>
      <quality_gate>
        The user knows which files exist, which prompts failed and why.
      </quality_gate>
    </phase>
  </phases>

  <error_recovery>
    <strategy name="model_not_ready">
      `--models` shows `set VAR to enable` for the chosen model: stop before generating,
      name the variable, and list any other model whose line reads `ready`. Never fall back
      to a different model without asking.
    </strategy>
    <strategy name="api_key_missing_at_runtime">
      Exit code 2 with `no API key found for ...`: report the variables the CLI names and
      the `--model` alternatives it lists under "Usable with the keys you have".
    </strategy>
    <strategy name="style_not_found">
      List `styles/*.md`. Suggest `/image:style create {name}`.
    </strategy>
    <strategy name="unknown_model">
      The CLI refuses near matches and prints the supported set. Show it; do not guess.
    </strategy>
    <strategy name="content_policy">
      Report the block and the rephrasing that would likely pass; do not retry unasked.
    </strategy>
    <strategy name="rate_limit">
      The AI SDK already retries with backoff. Offer one re-run with `--max-retries 5`.
    </strategy>
    <strategy name="partial_batch">
      Report which prompts succeeded and which failed, and the exact command that retries
      only the failures.
    </strategy>
  </error_recovery>
</orchestration>

<argument_parsing>
  **Prompt extraction:**
  - Single: "A mountain lake" -> ['A mountain lake']
  - Multiple: "cube" "sphere" -> ['cube' 'sphere']
  - Quoting: "it's here" -> 'it'\''s here'

  **Style resolution:**
  - --style glass -> styles/glass.md
  - --style styles/glass.md -> styles/glass.md (pass through)

  **Output path:**
  - Not given: slug of the first prompt under generated/
  - Batch: the CLI adds _001, _002 suffixes
</argument_parsing>

<examples>
  <example name="Simple">
    <input>/image:generate "A serene mountain lake at sunset"</input>
    <flow>
      1. Parse: prompts=['A serene mountain lake at sunset']
      2. `--models`: default model reads `ready`
      3. `mkdir -p generated`
      4. `bun "${CLAUDE_PLUGIN_ROOT}/src/main.ts" generated/a_serene_mountain_lake.png 'A serene mountain lake at sunset'`
      5. Report: generated/a_serene_mountain_lake.png
    </flow>
  </example>

  <example name="With style and model">
    <input>/image:generate "gear icon" --style glass --model seedream</input>
    <flow>
      1. Parse: prompts=['gear icon'], style=glass, model=seedream
      2. Resolve styles/glass.md; validate content
      3. `--models`: the seedream line must read `ready`
      4. `bun "${CLAUDE_PLUGIN_ROOT}/src/main.ts" generated/gear_icon.png 'gear icon' --style styles/glass.md --model seedream`
    </flow>
  </example>

  <example name="Batch">
    <input>/image:generate "cube" "sphere" "pyramid" --style glass --aspect 1:1</input>
    <flow>
      1. Parse: three prompts, style=glass, aspect=1:1
      2. Pre-flight as above
      3. `bun "${CLAUDE_PLUGIN_ROOT}/src/main.ts" generated/icons.png 'cube' 'sphere' 'pyramid' --style styles/glass.md --aspect 1:1`
      4. Report generated/icons_001.png (cube), _002 (sphere), _003 (pyramid); list any failure
    </flow>
  </example>
</examples>
