/** Composed output blocks shared by more than one command. */

import { formatUsd } from '@solvent/core';
import type { Hex, NetworkInfo, Usdc6 } from '@solvent/core';
import { bold, ink, solvent, underline } from './color.js';
import { encodeQr } from './qr.js';
import { bigAddress, box, note, out, qrLines } from './render.js';

export interface FundingPanelOptions {
  address: Hex;
  network: NetworkInfo;
  /** What the operator is being asked to send. null when any amount will do. */
  amount6: Usdc6 | null;
  breakdown?: string;
}

/**
 * The funding step of spawn, and the whole of `solvent fund`.
 *
 * The QR carries the bare address: wallets scan that everywhere, while an
 * EIP-681 payment URI is inconsistently supported and would not survive the
 * dual-interface USDC on Arc without ambiguity about which decimals it means.
 */
export function fundingPanel(opts: FundingPanelOptions): void {
  const { address, network, amount6 } = opts;

  out();
  const amount = amount6 === null ? ink('USDC') : `${bold(solvent(formatUsd(amount6)))} ${ink('USDC')}`;
  out(`  ${ink('Send')} ${amount} ${ink(`on ${network.name} to this address:`)}`);
  if (opts.breakdown !== undefined) note(opts.breakdown);
  out();

  const code = encodeQr(address, 'M');
  const lines = qrLines(code);
  if (lines === null) {
    box(bigAddress(address), 'funding address');
    note('QR is off because colour is off; the address above is the same thing.');
  } else {
    for (const line of lines) out(`  ${line}`);
  }

  out();
  out(`  ${bold(ink(address))}`);
  note(`${network.name} · chain ${network.id} · USDC only, nothing else on this chain is money here`);
  if (network.faucet !== null) note(`testnet USDC: ${underline(network.faucet)}`);
  out();
}
