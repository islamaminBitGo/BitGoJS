import * as utxolib from '@bitgo/utxo-lib';
import { bitgo } from '@bitgo/utxo-lib';
type Unspent = bitgo.Unspent;

export function getReplayProtectionAddresses(network: utxolib.Network): string[] {
  switch (network) {
    case utxolib.networks.bitcoincash:
    case utxolib.networks.bitcoinsv:
      return ['33p1q7mTGyeM5UnZERGiMcVUkY12SCsatA'];
    case utxolib.networks.bitcoincashTestnet:
    case utxolib.networks.bitcoinsvTestnet:
      return ['2MuMnPoSDgWEpNWH28X2nLtYMXQJCyT61eY'];
  }

  return [];
}

export function isReplayProtectionUnspent(u: Unspent, network: utxolib.Network): boolean {
  return getReplayProtectionAddresses(network).includes(u.address);
}
