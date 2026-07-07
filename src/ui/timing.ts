function shouldDelay(): boolean {
  return (
    process.stdout.isTTY &&
    process.env.PNPM_MIGRATE_AUTO_APPROVE !== "1" &&
    process.env.PNPM_MIGRATE_NO_UI_DELAYS !== "1"
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function sectionPause(ms = 450): Promise<void> {
  if (!shouldDelay() || ms <= 0) {
    return;
  }

  await sleep(ms);
}

export async function minimumVisible<T>(work: () => T | Promise<T>, ms = 650): Promise<T> {
  const start = Date.now();
  try {
    return await work();
  } finally {
    await sectionPause(ms - (Date.now() - start));
  }
}

export function uiSpacer(lines = 1): void {
  if (!process.stdout.isTTY) {
    return;
  }

  for (let i = 0; i < lines; i++) {
    process.stdout.write("│\n");
  }
}
