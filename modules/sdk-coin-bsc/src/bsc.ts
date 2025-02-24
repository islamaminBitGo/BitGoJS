import { BaseCoin, BitGoBase } from '@bitgo/sdk-core';
import { BaseCoin as StaticsBaseCoin, coins } from '@bitgo/statics';
import { AbstractEthLikeCoin } from '@bitgo/abstract-eth';
import { TransactionBuilder as EthTransactionBuilder } from '@bitgo/sdk-coin-eth';
import { TransactionBuilder } from './lib';

export class Bsc extends AbstractEthLikeCoin {
  protected constructor(bitgo: BitGoBase, staticsCoin?: Readonly<StaticsBaseCoin>) {
    super(bitgo, staticsCoin);
  }

  static createInstance(bitgo: BitGoBase, staticsCoin?: Readonly<StaticsBaseCoin>): BaseCoin {
    return new Bsc(bitgo, staticsCoin);
  }

  protected getTransactionBuilder(): EthTransactionBuilder {
    return new TransactionBuilder(coins.get(this.getBaseChain()));
  }
}
