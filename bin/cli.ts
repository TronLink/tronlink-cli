import { createProgram } from '../src/index.js';
import { setJsonMode } from '../src/lib/error.js';

/**
 * Normalize argv so that option names are case-insensitive.
 * e.g. --TYPE → --type, --TOADDRESS → --toAddress, --tokenid → --tokenId
 */
const OPTION_CANONICAL: Record<string, string> = {
  '--type': '--type',
  '--toaddress': '--toAddress',
  '--fromaddress': '--fromAddress',
  '--amount': '--amount',
  '--contract': '--contract',
  '--tokenid': '--tokenId',
  '--decimals': '--decimals',
  '--network': '--network',
  '--resource': '--resource',
  '--token': '--token',
  '--address': '--address',
  '--votes': '--votes',
  '--lock-period': '--lock-period',
  '--fee-limit': '--fee-limit',
  '--local-broadcast': '--local-broadcast',
  '--json': '--json',
  '--port': '--port',
  '--api-key': '--api-key',
  '--timeout': '--timeout',
  '--daemon': '--daemon',
};

function normalizeArgv(argv: string[]): string[] {
  return argv.map(arg => {
    if (!arg.startsWith('--')) return arg;
    const eqIdx = arg.indexOf('=');
    const key = eqIdx >= 0 ? arg.slice(0, eqIdx) : arg;
    const canonical = OPTION_CANONICAL[key.toLowerCase()];
    if (canonical) {
      return eqIdx >= 0 ? canonical + arg.slice(eqIdx) : canonical;
    }
    return arg;
  });
}

const normalizedArgv = normalizeArgv(process.argv);
if (normalizedArgv.includes('--json')) setJsonMode(true);
const program = createProgram();
program.parse(normalizedArgv);
