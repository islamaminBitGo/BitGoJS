import { BaseCoin as CoinConfig } from '@bitgo/statics';
import { DecodedSignedTx, DecodedSigningPayload, UnsignedTransaction } from '@substrate/txwrapper-core';
import { methods } from '@substrate/txwrapper-polkadot';
import BigNumber from 'bignumber.js';
import utils from './utils';
import { BaseAddress, DotAssetTypes, InvalidTransactionError, TransactionType } from '@bitgo/sdk-core';
import { MethodNames, StakeArgs, StakeArgsPayee, StakeArgsPayeeRaw } from './iface';
import { Transaction } from './transaction';
import { TransactionBuilder } from './transactionBuilder';
import { StakeTransactionSchema } from './txnSchema';

export class StakingBuilder extends TransactionBuilder {
  protected _amount: string;
  protected _controller: string;
  protected _payee: StakeArgsPayee;

  constructor(_coinConfig: Readonly<CoinConfig>) {
    super(_coinConfig);
  }

  /**
   * Take the origin account as a stash and lock up value of its balance.
   * Controller will be the account that controls it.
   *
   * @returns {UnsignedTransaction} an unsigned Dot transaction
   *
   * @see https://polkadot.js.org/docs/substrate/extrinsics/#staking
   */
  protected buildTransaction(): UnsignedTransaction {
    const baseTxInfo = this.createBaseTxInfo();
    return methods.staking.bond(
      {
        value: this._amount,
        controller: this._controller,
        payee: this._payee,
      },
      baseTxInfo.baseTxInfo,
      baseTxInfo.options
    );
  }

  protected get transactionType(): TransactionType {
    return TransactionType.StakingActivate;
  }

  /**
   * The amount to stake.
   *
   * @param {string} amount
   * @returns {StakeBuilder} This staking builder.
   *
   * @see https://wiki.polkadot.network/docs/learn-nominator#required-minimum-stake
   */
  amount(amount: string): this {
    this.validateValue(new BigNumber(amount));
    this._amount = amount;
    return this;
  }

  /**
   * The controller of the staked amount.
   *
   * @param {string} controller
   * @returns {StakeBuilder} This staking builder.
   *
   * @see https://wiki.polkadot.network/docs/learn-staking#accounts
   */
  owner(controller: BaseAddress): this {
    this.validateAddress(controller);
    this._controller = controller.address;
    return this;
  }

  /**
   * The rewards destination of the staked amount.
   * Can be set to another accounts address.
   *
   * @param {string} payee
   * @returns {StakeBuilder} This staking builder.
   *
   * @see https://wiki.polkadot.network/docs/learn-staking#4-rewards-mechanism
   */
  payee(payee: StakeArgsPayee): this {
    if (typeof payee !== 'string') {
      this.validateAddress({ address: payee.Account });
      this._payee = { Account: payee.Account };
    } else {
      this._payee = payee;
    }
    return this;
  }

  /** @inheritdoc */
  validateDecodedTransaction(decodedTxn: DecodedSigningPayload | DecodedSignedTx): void {
    if (decodedTxn.method?.name === MethodNames.Bond) {
      const txMethod = decodedTxn.method.args as unknown as StakeArgs;
      const value = txMethod.value;
      const controller = txMethod.controller.id;
      const payee = txMethod.payee;
      const validationResult = StakeTransactionSchema.validate({ value, controller, payee });
      if (validationResult.error) {
        throw new InvalidTransactionError(`Transaction validation failed: ${validationResult.error.message}`);
      }
    }
  }

  /** @inheritdoc */
  protected fromImplementation(rawTransaction: string): Transaction {
    const tx = super.fromImplementation(rawTransaction);
    if (this._method?.name === MethodNames.Bond) {
      const txMethod = this._method.args as StakeArgs;
      this.amount(txMethod.value);
      this.owner({
        address: utils.decodeDotAddress(
          txMethod.controller.id,
          utils.getAddressFormat(this._coinConfig.name as DotAssetTypes)
        ),
      });

      const payee = txMethod.payee as StakeArgsPayeeRaw;
      if (payee.account) {
        this.payee({
          Account: utils.decodeDotAddress(
            payee.account,
            utils.getAddressFormat(this._coinConfig.name as DotAssetTypes)
          ),
        });
      } else {
        const payeeType = utils.capitalizeFirstLetter(Object.keys(payee)[0]) as StakeArgsPayee;
        this.payee(payeeType);
      }
    } else {
      throw new InvalidTransactionError(`Invalid Transaction Type: ${this._method?.name}. Expected bond`);
    }
    return tx;
  }

  /** @inheritdoc */
  validateTransaction(_: Transaction): void {
    super.validateTransaction(_);
    this.validateFields(this._amount, this._controller, this._payee);
  }

  private validateFields(value: string, controller: string, payee: StakeArgsPayee): void {
    const validationResult = StakeTransactionSchema.validate({
      value,
      controller,
      payee,
    });

    if (validationResult.error) {
      throw new InvalidTransactionError(
        `Stake Builder Transaction validation failed: ${validationResult.error.message}`
      );
    }
  }
}
