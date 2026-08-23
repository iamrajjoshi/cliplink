export const HELP_TEXT = `clip — clip web content into markdown for clip.rajjoshi.me

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
  --help, -h                     show this help
  --version                      print the CLI version
`;

export function printHelp(): void {
  console.log(HELP_TEXT);
}
