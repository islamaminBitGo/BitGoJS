import { DelegatorTxBuilder } from './delegatorTxBuilder';
import { BaseCoin } from '@bitgo/statics';
import { AddValidatorTx, BaseTx, PlatformVMConstants, Tx, UnsignedTx } from 'avalanche/dist/apis/platformvm';
import { BuildTransactionError, NotSupported, TransactionType } from '@bitgo/sdk-core';
import utils from './utils';

export class ValidatorTxBuilder extends DelegatorTxBuilder {
  protected _delegationFeeRate: number;

  /**
   * @param coinConfig
   */
  constructor(coinConfig: Readonly<BaseCoin>) {
    super(coinConfig);
  }

  /**
   * get transaction type
   * @protected
   */
  protected get transactionType(): TransactionType {
    return TransactionType.addValidator;
  }

  /**
   * set the delegationFeeRate
   * @param value number
   */
  delegationFeeRate(value: number): this {
    this.validateDelegationFeeRate(value);
    this._delegationFeeRate = value;
    return this;
  }

  /**
   * Validate that the delegation fee is at least the minDelegationFee
   * @param delegationFeeRate number
   */
  validateDelegationFeeRate(delegationFeeRate: number): void {
    if (delegationFeeRate < Number(this.transaction._network.minDelegationFee)) {
      throw new BuildTransactionError(
        `Delegation fee cannot be less than ${this.transaction._network.minDelegationFee}`
      );
    }
  }

  /**
   * Initialize the builder
   * @param tx BaseTx
   * @returns ValidatorTxBuilder
   */
  initBuilder(tx: Tx): this {
    super.initBuilder(tx);
    const baseTx: BaseTx = tx.getUnsignedTx().getTransaction();
    if (!this.verifyTxType(baseTx)) {
      throw new NotSupported('Transaction cannot be parsed or has an unsupported transaction type');
    }
    this._delegationFeeRate = baseTx.getDelegationFee();
    return this;
  }

  static verifyTxType(baseTx: BaseTx): baseTx is AddValidatorTx {
    return baseTx.getTypeID() === PlatformVMConstants.ADDVALIDATORTX;
  }

  verifyTxType(baseTx: BaseTx): baseTx is AddValidatorTx {
    return ValidatorTxBuilder.verifyTxType(baseTx);
  }

  /**
   * Build the validator transaction
   * @protected
   */
  protected buildAvaxpTransaction(): void {
    const { inputs, outputs, credentials } = this.createInputOutput();
    this.transaction.setTransaction(
      new Tx(
        new UnsignedTx(
          new AddValidatorTx(
            this.transaction._networkID,
            this.transaction._blockchainID,
            outputs,
            inputs,
            this.transaction._memo,
            utils.NodeIDStringToBuffer(this._nodeID),
            this._startTime,
            this._endTime,
            this._stakeAmount,
            [this.stakeTransferOut()],
            this.rewardOwnersOutput(),
            this._delegationFeeRate
          )
        ),
        credentials
      )
    );
  }
}
