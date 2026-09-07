export const HELP_TEXT = `clip — save links, images, and notes to your collection

usage:
  clip <url | path | ->          clip a URL, local image file, or stdin note
  clip login                     authenticate with GitHub (OAuth Device Flow)
  clip logout                    remove the stored authentication token
  clip config                    show current configuration
  clip config get <key>          show a specific config value
  clip config set <key> <value>  set a config value
  clip init                      create a new clip site repository from the template

commands:
  login                          authenticate via GitHub OAuth Device Flow
  logout                         remove the stored GitHub token
  config                         view or set configuration
  init                           create a new GitHub repo from the clip template and auto-configure it
  <url | path | ->               clip a URL, local image file, or stdin note

flags:
  --local                        force local mode (write files, commit, push via local git)
  --repo <path>                  target the clip repo when running from outside the workspace
  --dry-run                      print the clip that would be written without changing the repo
  --no-push                      commit locally but skip git push
  --tag <tag>                    add one tag (repeatable; commas are literal)
  --tags <tags>                  add comma-separated tags (repeatable)
  --title <text>                 override the title and generated slug for links or videos
  --description <text>           override a link's description
  --alt <text>                   override a local image's alt text
  --note <markdown>              add a Markdown note without opening the editor; append to stdin
  --help, -h                     show this help
  --version                      print the CLI version

Value flags also accept --flag=value. Use -- to end options before the input.
Tags are trimmed and deduplicated case-sensitively; default tags are kept first.
Repeated title, description, alt, or note flags use the last value.
`;

export function printHelp(): void {
  console.log(HELP_TEXT);
}
