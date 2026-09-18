/**
 * requestHash, exactly as SPEC 3.4 defines it:
 *
 *     keccak256(method | url | bodyHash | nonce)
 *
 * Both sides compute it the same way from the same four inputs. The client puts
 * the four inputs in the X-PAYMENT header; the server recomputes the hash rather
 * than trusting the one it was handed, which is what stops a receipt for one
 * request being replayed against another.
 */

import { randomBytes } from 'node:crypto';
import { encodePacked, keccak256, stringToHex } from 'viem';
import type { Hex } from '@solvent/core';

export interface RequestParts {
  method: string;
  url: string;
  bodyHash: Hex;
  nonce: Hex;
}

export function bodyHashOf(body: string | undefined | null): Hex {
  return keccak256(stringToHex(body ?? ''));
}

export function randomNonce(): Hex {
  return `0x${randomBytes(32).toString('hex')}` as Hex;
}

export function requestHashOf(parts: RequestParts): Hex {
  return keccak256(
    encodePacked(
      ['string', 'string', 'bytes32', 'bytes32'],
      [parts.method.toUpperCase(), parts.url, parts.bodyHash, parts.nonce],
    ),
  );
}

/** Same URL string on both sides or the hashes differ. Normalise once, here. */
export function canonicalUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = '';
  return url.toString();
}
