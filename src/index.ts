import { Command, InvalidArgumentError } from 'commander';
import { setJsonMode, isJsonMode } from './lib/error.js';
import { registerTransferCommand } from './commands/transfer.js';
import { registerStakeCommand } from './commands/stake.js';
import { registerUnstakeCommand } from './commands/unstake.js';
import { registerWithdrawCommand } from './commands/withdraw.js';
import { registerResourceCommand } from './commands/resource.js';
import { registerDelegateCommand } from './commands/delegate.js';
import { registerReclaimCommand } from './commands/reclaim.js';
import { registerNetworkCommand } from './commands/network.js';
import { registerBalanceCommand } from './commands/balance.js';
import { registerConnectCommand } from './commands/connect.js';
import { registerVoteCommand } from './commands/vote.js';
import { registerRewardCommand } from './commands/reward.js';
import { registerServeCommand } from './commands/serve.js';

export function createProgram(): Command {
  const program = new Command();

  program.configureOutput({
    writeErr: (str) => {
      if (isJsonMode()) {
        const msg = str
          // eslint-disable-next-line no-control-regex
          .replace(/\x1b\[[0-9;]*m/g, '')
          .replace(/^error:\s*/i, '')
          .trim();
        process.stderr.write(JSON.stringify({ status: 'error', error: msg }) + '\n');
      } else {
        process.stderr.write(str);
      }
    },
  });

  program
    .name('tronlink')
    .description('CLI for TRON blockchain operations via TronLink wallet')
    .version('0.1.0')
    .option('--local-broadcast', 'Broadcast via CLI local TronWeb instead of signer TronWeb')
    .option('--json', 'Output as JSON')
    .option('--port <n>', 'TronLink Signer HTTP port', (val: string) => {
      const n = Number(val);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        throw new InvalidArgumentError(`Invalid port: "${val}". Must be an integer between 1 and 65535`);
      }
      return n;
    }, 3386)
    .option('--api-key <key>', 'TronGrid API key (or set TRON_API_KEY env)')
    .option('--timeout <ms>', 'Signing timeout in ms (default: 300000)', (val: string) => {
      const n = Number(val);
      if (!Number.isInteger(n) || n <= 0) {
        throw new InvalidArgumentError(`Invalid timeout: "${val}". Must be a positive integer (ms)`);
      }
      process.env.TRONLINK_TIMEOUT = val;
      return val;
    });

  program.hook('preAction', (thisCommand) => {
    setJsonMode(!!thisCommand.optsWithGlobals().json);
  });

  registerConnectCommand(program);
  registerTransferCommand(program);
  registerStakeCommand(program);
  registerUnstakeCommand(program);
  registerWithdrawCommand(program);
  registerResourceCommand(program);
  registerDelegateCommand(program);
  registerReclaimCommand(program);
  registerNetworkCommand(program);
  registerBalanceCommand(program);
  registerVoteCommand(program);
  registerRewardCommand(program);
  registerServeCommand(program);

  return program;
}
