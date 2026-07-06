export type StageStatus = "active" | "done" | "failed" | "pending";

export type DeterministicStage = {
  id: string;
  label: string;
  phases?: string[];
  status?: StageStatus;
};

export const deterministicStages: DeterministicStage[] = [
  { id: "worktree", label: "Create isolated git worktree" },
  {
    id: "config",
    label: "Migrate npm config -> pnpm",
    phases: [
      "select_agent",
      "preflight",
      "write_pnpm_workspace",
      "set_package_manager",
      "normalize_github_tarballs",
      "convert_lockfile",
      "repair_imported_transitive_deps",
      "remove_npm_lockfiles",
    ],
  },
  {
    id: "repo",
    label: "Rewrite scripts and workspace assumptions",
    phases: [
      "rewrite_package_scripts",
      "fix_karma_configs",
      "repair_workspace_import_deps",
      "repair_node_types_dependency",
    ],
  },
  { id: "install", label: "Install dependencies with pnpm", phases: ["install_deps"] },
  {
    id: "docs",
    label: "Migrate CI, Docker, documentation",
    phases: [
      "format_metadata",
      "rewrite_ci_npm_commands",
      "rewrite_markdown_npm_commands",
      "report_remaining_npm_commands",
      "run_agent",
    ],
  },
  { id: "verify", label: "Verify migration worked", phases: ["run_verification"] },
  { id: "commit", label: "Commit migration branch" },
];
