/**
 * @prettier
 */
import * as bip32 from 'bip32';
import { BigNumber } from 'bignumber.js';
import { randomBytes } from 'crypto';
import debugLib from 'debug';
import Keccak from 'keccak';
import _ from 'lodash';
import secp256k1 from 'secp256k1';
import request from 'superagent';

import { Erc20Token } from './erc20Token';
import {
  AddressCoinSpecific,
  BaseCoin,
  BitGoBase,
  checkKrsProvider,
  common,
  EthereumLibraryUnavailableError,
  FeeEstimateOptions,
  getIsKrsRecovery,
  getIsUnsignedSweep,
  InvalidAddressError,
  InvalidAddressVerificationObjectPropertyError,
  IWallet,
  KeyPair,
  ParsedTransaction,
  ParseTransactionOptions,
  UnexpectedAddressError,
  PresignTransactionOptions as BasePresignTransactionOptions,
  SignTransactionOptions as BaseSignTransactionOptions,
  TransactionParams,
  TransactionPrebuild as BaseTransactionPrebuild,
  TransactionRecipient,
  Util,
  VerifyAddressOptions as BaseVerifyAddressOptions,
  VerifyTransactionOptions,
  Wallet,
  Recipient,
  HalfSignedTransaction,
  FullySignedTransaction,
} from '@bitgo/sdk-core';

import { BaseCoin as StaticsBaseCoin, EthereumNetwork, ethGasConfigs } from '@bitgo/statics';
import type * as EthTxLib from '@ethereumjs/tx';
import type * as EthCommon from '@ethereumjs/common';
import { calculateForwarderV1Address, getProxyInitcode } from './lib';

export { Recipient, HalfSignedTransaction, FullySignedTransaction };

const debug = debugLib('bitgo:v2:eth');

export const optionalDeps = {
  get ethAbi() {
    try {
      return require('ethereumjs-abi');
    } catch (e) {
      debug('unable to load ethereumjs-abi:');
      debug(e.stack);
      throw new EthereumLibraryUnavailableError(`ethereumjs-abi`);
    }
  },

  get ethUtil() {
    try {
      return require('ethereumjs-util');
    } catch (e) {
      debug('unable to load ethereumjs-util:');
      debug(e.stack);
      throw new EthereumLibraryUnavailableError(`ethereumjs-util`);
    }
  },

  get EthTx(): typeof EthTxLib {
    try {
      return require('@ethereumjs/tx');
    } catch (e) {
      debug('unable to load @ethereumjs/tx');
      debug(e.stack);
      throw new EthereumLibraryUnavailableError(`@ethereumjs/tx`);
    }
  },

  get EthCommon(): typeof EthCommon {
    try {
      return require('@ethereumjs/common');
    } catch (e) {
      debug('unable to load @ethereumjs/common:');
      debug(e.stack);
      throw new EthereumLibraryUnavailableError(`@ethereumjs/common`);
    }
  },
};

/**
 * The extra parameters to send to platform build route for hop transactions
 */
interface HopParams {
  hopParams: {
    gasPriceMax: number;
    userReqSig: string;
    paymentId: string;
  };
  gasLimit: number;
}

/**
 * The prebuilt hop transaction returned from the HSM
 */
interface HopPrebuild {
  tx: string;
  id: string;
  signature: string;
  paymentId: string;
  gasPrice: number;
  gasLimit: number;
  amount: number;
  recipient: string;
  nonce: number;
  userReqSig: string;
  gasPriceMax: number;
}

interface EIP1559 {
  maxPriorityFeePerGas: number;
  maxFeePerGas: number;
}

interface ReplayProtectionOptions {
  chain: string | number;
  hardfork: string;
}

export interface SignFinalOptions {
  txPrebuild: {
    eip1559?: EIP1559;
    replayProtectionOptions?: ReplayProtectionOptions;
    gasPrice?: string;
    gasLimit: string;
    recipients: Recipient[];
    halfSigned: {
      expireTime: number;
      contractSequenceId: number;
      backupKeyNonce?: number;
      signature: string;
    };
    nextContractSequenceId?: number;
    hopTransaction?: string;
    backupKeyNonce?: number;
    isBatch?: boolean;
  };
  signingKeyNonce: number;
  walletContractAddress: string;
  prv: string;
  recipients: Recipient[];
}

export interface SignTransactionOptions extends BaseSignTransactionOptions, SignFinalOptions {
  isLastSignature?: boolean;
  expireTime: number;
  sequenceId: number;
  gasLimit: number;
  gasPrice: number;
  custodianTransactionId?: string;
}

export type SignedTransaction = HalfSignedTransaction | FullySignedTransaction;

interface PrecreateBitGoOptions {
  enterprise?: string;
  newFeeAddress?: string;
}

interface OfflineVaultTxInfo {
  nextContractSequenceId?: string;
  contractSequenceId?: string;
  tx: string;
  userKey: string;
  backupKey: string;
  coin: string;
  gasPrice: number;
  gasLimit: number;
  recipients: Recipient[];
  walletContractAddress: string;
  amount: string;
  backupKeyNonce: number;
  // For Eth Specific Coins
  eip1559?: EIP1559;
  replayProtectionOptions?: ReplayProtectionOptions;
}

interface UnformattedTxInfo {
  recipient: Recipient;
}

export interface RecoverOptions {
  userKey: string;
  backupKey: string;
  walletPassphrase?: string;
  walletContractAddress: string;
  recoveryDestination: string;
  krsProvider?: string;
  gasPrice?: number;
  gasLimit?: number;
  eip1559?: EIP1559;
  replayProtectionOptions?: ReplayProtectionOptions;
}

export interface BuildTransactionParams {
  to: string;
  nonce?: number;
  value: number;
  data?: Buffer;
  gasPrice?: number;
  gasLimit?: number;
  eip1559?: EIP1559;
  replayProtectionOptions?: ReplayProtectionOptions;
}

export interface RecoveryInfo {
  id: string;
  tx: string;
  backupKey?: string;
  coin?: string;
}

interface RecoverTokenOptions {
  tokenContractAddress: string;
  wallet: Wallet;
  recipient: string;
  broadcast?: boolean;
  walletPassphrase?: string;
  prv?: string;
}

export interface GetSendMethodArgsOptions {
  recipient: Recipient;
  expireTime: number;
  contractSequenceId: number;
  signature: string;
}

export interface SendMethodArgs {
  name: string;
  type: string;
  value: any;
}

interface HopTransactionBuildOptions {
  wallet: Wallet;
  recipients: Recipient[];
  walletPassphrase: string;
}

interface BuildOptions {
  hop?: boolean;
  wallet?: Wallet;
  recipients?: Recipient[];
  walletPassphrase?: string;
  [index: string]: unknown;
}

interface FeeEstimate {
  gasLimitEstimate: number;
  feeEstimate: number;
}

export interface TransactionPrebuild extends BaseTransactionPrebuild {
  hopTransaction?: HopPrebuild;
  buildParams: {
    recipients: Recipient[];
  };
  recipients: TransactionRecipient[];
  nextContractSequenceId: string;
  gasPrice: number;
  gasLimit: number;
  isBatch: boolean;
  coin: string;
  token?: string;
}

// TODO: This interface will need to be updated for the new fee model introduced in the London Hard Fork
interface EthTransactionParams extends TransactionParams {
  gasPrice?: number;
  gasLimit?: number;
  hopParams?: HopParams;
  hop?: boolean;
}

interface VerifyEthTransactionOptions extends VerifyTransactionOptions {
  txPrebuild: TransactionPrebuild;
  txParams: EthTransactionParams;
}

interface PresignTransactionOptions extends TransactionPrebuild, BasePresignTransactionOptions {
  wallet: Wallet;
}

interface RecoverTokenTransaction {
  halfSigned: {
    recipient: Recipient;
    expireTime: number;
    contractSequenceId: number;
    operationHash: string;
    signature: string;
    gasLimit: number;
    gasPrice: number;
    tokenContractAddress: string;
    walletId: string;
  };
}

interface EthAddressCoinSpecifics extends AddressCoinSpecific {
  forwarderVersion: number;
  salt?: string;
}

interface VerifyEthAddressOptions extends BaseVerifyAddressOptions {
  baseAddress: string;
  coinSpecific: EthAddressCoinSpecifics;
  forwarderVersion: number;
}

export class Eth extends BaseCoin {
  static hopTransactionSalt = 'bitgoHopAddressRequestSalt';
  protected readonly sendMethodName: 'sendMultiSig' | 'sendMultiSigToken';

  readonly staticsCoin?: Readonly<StaticsBaseCoin>;

  protected constructor(bitgo: BitGoBase, staticsCoin?: Readonly<StaticsBaseCoin>) {
    super(bitgo);
    this.staticsCoin = staticsCoin;
    this.sendMethodName = 'sendMultiSig';
  }

  static createInstance(bitgo: BitGoBase, staticsCoin?: Readonly<StaticsBaseCoin>): BaseCoin {
    return new Eth(bitgo, staticsCoin);
  }

  static buildTransaction(params: BuildTransactionParams): EthTxLib.FeeMarketEIP1559Transaction | EthTxLib.Transaction {
    // if eip1559 params are specified, default to london hardfork, otherwise,
    // default to tangerine whistle to avoid replay protection issues
    const defaultHardfork = !!params.eip1559 ? 'london' : optionalDeps.EthCommon.Hardfork.TangerineWhistle;
    const defaultCommon = new optionalDeps.EthCommon.default({
      chain: optionalDeps.EthCommon.Chain.Mainnet,
      hardfork: defaultHardfork,
    });

    // if replay protection options are set, override the default common setting
    const ethCommon = params.replayProtectionOptions
      ? new optionalDeps.EthCommon.default({
          chain: params.replayProtectionOptions.chain,
          hardfork: params.replayProtectionOptions.hardfork,
        })
      : defaultCommon;

    const baseParams = {
      to: params.to,
      nonce: params.nonce,
      value: params.value,
      data: params.data,
      gasLimit: new optionalDeps.ethUtil.BN(params.gasLimit),
    };

    const unsignedEthTx = !!params.eip1559
      ? optionalDeps.EthTx.FeeMarketEIP1559Transaction.fromTxData(
          {
            ...baseParams,
            maxFeePerGas: new optionalDeps.ethUtil.BN(params.eip1559.maxFeePerGas),
            maxPriorityFeePerGas: new optionalDeps.ethUtil.BN(params.eip1559.maxPriorityFeePerGas),
          },
          { common: ethCommon }
        )
      : optionalDeps.EthTx.Transaction.fromTxData(
          {
            ...baseParams,
            gasPrice: new optionalDeps.ethUtil.BN(params.gasPrice),
          },
          { common: ethCommon }
        );

    return unsignedEthTx;
  }

  /**
   * Returns the factor between the base unit and its smallest subdivison
   * @return {number}
   */
  getBaseFactor(): string {
    // 10^18
    return '1000000000000000000';
  }

  getChain(): string {
    return 'eth';
  }

  getFamily(): string {
    return 'eth';
  }

  getNetwork(): EthereumNetwork | undefined {
    return this.staticsCoin?.network as EthereumNetwork;
  }

  getFullName(): string {
    return 'Ethereum';
  }

  /**
   * Flag for sending value of 0
   * @returns {boolean} True if okay to send 0 value, false otherwise
   */
  valuelessTransferAllowed() {
    return true;
  }

  /**
   * Flag for sending data along with transactions
   * @returns {boolean} True if okay to send tx data (ETH), false otherwise
   */
  transactionDataAllowed() {
    return true;
  }

  /**
   * Evaluates whether an address string is valid for this coin
   * @param address
   */
  isValidAddress(address: string): boolean {
    return optionalDeps.ethUtil.isValidAddress(optionalDeps.ethUtil.addHexPrefix(address));
  }

  /**
   * Return boolean indicating whether input is valid public key for the coin.
   *
   * @param {String} pub the pub to be checked
   * @returns {Boolean} is it valid?
   */
  isValidPub(pub: string): boolean {
    try {
      return bip32.fromBase58(pub).isNeutered();
    } catch (e) {
      return false;
    }
  }

  /**
   * Default gas price from platform
   * @returns {BigNumber}
   */
  getRecoveryGasPrice(): any {
    return new optionalDeps.ethUtil.BN('20000000000');
  }

  /**
   * Default gas limit from platform
   * @returns {BigNumber}
   */
  getRecoveryGasLimit(): any {
    return new optionalDeps.ethUtil.BN('500000');
  }

  /**
   * Default expire time for a contract call (1 week)
   * @returns {number} Time in seconds
   */
  getDefaultExpireTime(): number {
    return Math.floor(new Date().getTime() / 1000) + 60 * 60 * 24 * 7;
  }

  /**
   * Query Etherscan for the balance of an address
   * @param address {String} the ETH address
   * @returns {BigNumber} address balance
   */
  async queryAddressBalance(address: string): Promise<any> {
    const result = await this.recoveryBlockchainExplorerQuery({
      module: 'account',
      action: 'balance',
      address: address,
    });
    // throw if the result does not exist or the result is not a valid number
    if (!result || !result.result || isNaN(result.result)) {
      throw new Error(`Could not obtain address balance for ${address} from Etherscan, got: ${result.result}`);
    }
    return new optionalDeps.ethUtil.BN(result.result, 10);
  }

  /**
   * Query Etherscan for the balance of an address for a token
   * @param tokenContractAddress {String} address where the token smart contract is hosted
   * @param walletContractAddress {String} address of the wallet
   * @returns {BigNumber} token balaance in base units
   */
  async queryAddressTokenBalance(tokenContractAddress: string, walletContractAddress: string): Promise<any> {
    if (!optionalDeps.ethUtil.isValidAddress(tokenContractAddress)) {
      throw new Error('cannot get balance for invalid token address');
    }
    if (!optionalDeps.ethUtil.isValidAddress(walletContractAddress)) {
      throw new Error('cannot get token balance for invalid wallet address');
    }

    const result = await this.recoveryBlockchainExplorerQuery({
      module: 'account',
      action: 'tokenbalance',
      contractaddress: tokenContractAddress,
      address: walletContractAddress,
      tag: 'latest',
    });
    // throw if the result does not exist or the result is not a valid number
    if (!result || !result.result || isNaN(result.result)) {
      throw new Error(
        `Could not obtain token address balance for ${tokenContractAddress} from Etherscan, got: ${result.result}`
      );
    }
    return new optionalDeps.ethUtil.BN(result.result, 10);
  }

  /**
   * Get transfer operation for coin
   * @param recipient recipient info
   * @param expireTime expiry time
   * @param contractSequenceId sequence id
   * @returns {Array} operation array
   */
  getOperation(recipient: Recipient, expireTime: number, contractSequenceId: number): (string | Buffer)[][] {
    return [
      ['string', 'address', 'uint', 'bytes', 'uint', 'uint'],
      [
        'ETHER',
        new optionalDeps.ethUtil.BN(optionalDeps.ethUtil.stripHexPrefix(recipient.address), 16),
        recipient.amount,
        Buffer.from(optionalDeps.ethUtil.stripHexPrefix(optionalDeps.ethUtil.padToEven(recipient.data || '')), 'hex'),
        expireTime,
        contractSequenceId,
      ],
    ];
  }

  getOperationSha3ForExecuteAndConfirm(
    recipients: Recipient[],
    expireTime: number,
    contractSequenceId: number
  ): string {
    if (!recipients || !Array.isArray(recipients)) {
      throw new Error('expecting array of recipients');
    }

    // Right now we only support 1 recipient
    if (recipients.length !== 1) {
      throw new Error('must send to exactly 1 recipient');
    }

    if (!_.isNumber(expireTime)) {
      throw new Error('expireTime must be number of seconds since epoch');
    }

    if (!_.isNumber(contractSequenceId)) {
      throw new Error('contractSequenceId must be number');
    }

    // Check inputs
    recipients.forEach(function (recipient) {
      if (
        !_.isString(recipient.address) ||
        !optionalDeps.ethUtil.isValidAddress(optionalDeps.ethUtil.addHexPrefix(recipient.address))
      ) {
        throw new Error('Invalid address: ' + recipient.address);
      }

      let amount;
      try {
        amount = new BigNumber(recipient.amount);
      } catch (e) {
        throw new Error('Invalid amount for: ' + recipient.address + ' - should be numeric');
      }

      recipient.amount = amount.toFixed(0);

      if (recipient.data && !_.isString(recipient.data)) {
        throw new Error('Data for recipient ' + recipient.address + ' - should be of type hex string');
      }
    });

    const recipient = recipients[0];
    return optionalDeps.ethUtil.bufferToHex(
      optionalDeps.ethAbi.soliditySHA3(...this.getOperation(recipient, expireTime, contractSequenceId))
    );
  }

  /**
   * Queries the contract (via Etherscan) for the next sequence ID
   * @param address {String} address of the contract
   * @returns {Number} sequence ID
   */
  async querySequenceId(address: string): Promise<number> {
    // Get sequence ID using contract call
    const sequenceIdMethodSignature = optionalDeps.ethAbi.methodID('getNextSequenceId', []);
    const sequenceIdArgs = optionalDeps.ethAbi.rawEncode([], []);
    const sequenceIdData = Buffer.concat([sequenceIdMethodSignature, sequenceIdArgs]).toString('hex');
    const result = await this.recoveryBlockchainExplorerQuery({
      module: 'proxy',
      action: 'eth_call',
      to: address,
      data: sequenceIdData,
      tag: 'latest',
    });
    if (!result || !result.result) {
      throw new Error('Could not obtain sequence ID from Etherscan, got: ' + result.result);
    }
    const sequenceIdHex = result.result;
    return new optionalDeps.ethUtil.BN(sequenceIdHex.slice(2), 16).toNumber();
  }

  /**
   * Helper function for signTransaction for the rare case that SDK is doing the second signature
   * Note: we are expecting this to be called from the offline vault
   * @param params.txPrebuild
   * @param params.signingKeyNonce
   * @param params.walletContractAddress
   * @param params.prv
   * @returns {{txHex: *}}
   */
  signFinal(params: SignFinalOptions): FullySignedTransaction {
    const txPrebuild = params.txPrebuild;

    if (!_.isNumber(params.signingKeyNonce) && !_.isNumber(params.txPrebuild.halfSigned.backupKeyNonce)) {
      throw new Error(
        'must have at least one of signingKeyNonce and backupKeyNonce as a parameter, and it must be a number'
      );
    }
    if (_.isUndefined(params.walletContractAddress)) {
      throw new Error('params must include walletContractAddress, but got undefined');
    }

    const signingNode = bip32.fromBase58(params.prv);
    const signingKey = signingNode.privateKey;
    if (_.isUndefined(signingKey)) {
      throw new Error('missing private key');
    }

    const txInfo = {
      recipient: txPrebuild.recipients[0],
      expireTime: txPrebuild.halfSigned.expireTime,
      contractSequenceId: txPrebuild.halfSigned.contractSequenceId,
      signature: txPrebuild.halfSigned.signature,
    };

    const sendMethodArgs = this.getSendMethodArgs(txInfo);
    const methodSignature = optionalDeps.ethAbi.methodID(this.sendMethodName, _.map(sendMethodArgs, 'type'));
    const encodedArgs = optionalDeps.ethAbi.rawEncode(_.map(sendMethodArgs, 'type'), _.map(sendMethodArgs, 'value'));
    const sendData = Buffer.concat([methodSignature, encodedArgs]);

    const ethTxParams = {
      to: params.walletContractAddress,
      nonce:
        params.signingKeyNonce !== undefined ? params.signingKeyNonce : params.txPrebuild.halfSigned.backupKeyNonce,
      value: 0,
      gasPrice: new optionalDeps.ethUtil.BN(txPrebuild.gasPrice),
      gasLimit: new optionalDeps.ethUtil.BN(txPrebuild.gasLimit),
      data: sendData,
    };

    const unsignedEthTx = Eth.buildTransaction({
      ...ethTxParams,
      eip1559: params.txPrebuild.eip1559,
      replayProtectionOptions: params.txPrebuild.replayProtectionOptions,
    });

    const ethTx = unsignedEthTx.sign(signingKey);

    return { txHex: ethTx.serialize().toString('hex') };
  }

  /**
   * Assemble keychain and half-sign prebuilt transaction
   * @param params
   * - txPrebuild
   * - prv
   * @returns {Promise<SignedTransaction>}
   */
  async signTransaction(params: SignTransactionOptions): Promise<SignedTransaction> {
    const txPrebuild = params.txPrebuild;

    const userPrv = params.prv;
    const EXPIRETIME_DEFAULT = 60 * 60 * 24 * 7; // This signature will be valid for 1 week

    if (_.isUndefined(txPrebuild) || !_.isObject(txPrebuild)) {
      if (!_.isUndefined(txPrebuild) && !_.isObject(txPrebuild)) {
        throw new Error(`txPrebuild must be an object, got type ${typeof txPrebuild}`);
      }
      throw new Error('missing txPrebuild parameter');
    }

    if (_.isUndefined(userPrv) || !_.isString(userPrv)) {
      if (!_.isUndefined(userPrv) && !_.isString(userPrv)) {
        throw new Error(`prv must be a string, got type ${typeof userPrv}`);
      }
      throw new Error('missing prv parameter to sign transaction');
    }

    params.recipients = txPrebuild.recipients || params.recipients;

    // if no recipients in either params or txPrebuild, then throw an error
    if (!params.recipients || !Array.isArray(params.recipients)) {
      throw new Error('recipients missing or not array');
    }

    if (params.recipients.length == 0) {
      throw new Error('recipients empty');
    }

    // Normally the SDK provides the first signature for an ETH tx, but occasionally it provides the second and final one.
    if (params.isLastSignature) {
      // In this case when we're doing the second (final) signature, the logic is different.
      return this.signFinal(params);
    }

    const secondsSinceEpoch = Math.floor(new Date().getTime() / 1000);
    const expireTime = params.expireTime || secondsSinceEpoch + EXPIRETIME_DEFAULT;
    const sequenceId = txPrebuild.nextContractSequenceId;

    if (_.isUndefined(sequenceId)) {
      throw new Error('transaction prebuild missing required property nextContractSequenceId');
    }

    const operationHash = this.getOperationSha3ForExecuteAndConfirm(params.recipients, expireTime, sequenceId);
    const signature = Util.ethSignMsgHash(operationHash, Util.xprvToEthPrivateKey(userPrv));

    const txParams = {
      eip1559: params.txPrebuild.eip1559,
      isBatch: params.txPrebuild.isBatch,
      recipients: params.recipients,
      expireTime: expireTime,
      contractSequenceId: sequenceId,
      sequenceId: params.sequenceId,
      operationHash: operationHash,
      signature: signature,
      gasLimit: params.gasLimit,
      gasPrice: params.gasPrice,
      hopTransaction: txPrebuild.hopTransaction,
      backupKeyNonce: txPrebuild.backupKeyNonce,
      custodianTransactionId: params.custodianTransactionId,
    };
    return { halfSigned: txParams };
  }

  /**
   * Ensure either enterprise or newFeeAddress is passed, to know whether to create new key or use enterprise key
   * @param params
   * @param params.enterprise {String} the enterprise id to associate with this key
   * @param params.newFeeAddress {Boolean} create a new fee address (enterprise not needed in this case)
   */
  preCreateBitGo(params: PrecreateBitGoOptions): void {
    // We always need params object, since either enterprise or newFeeAddress is required
    if (!_.isObject(params)) {
      throw new Error(`preCreateBitGo must be passed a params object. Got ${params} (type ${typeof params})`);
    }

    if (_.isUndefined(params.enterprise) && _.isUndefined(params.newFeeAddress)) {
      throw new Error(
        'expecting enterprise when adding BitGo key. If you want to create a new ETH bitgo key, set the newFeeAddress parameter to true.'
      );
    }

    // Check whether key should be an enterprise key or a BitGo key for a new fee address
    if (!_.isUndefined(params.enterprise) && !_.isUndefined(params.newFeeAddress)) {
      throw new Error(`Incompatible arguments - cannot pass both enterprise and newFeeAddress parameter.`);
    }

    if (!_.isUndefined(params.enterprise) && !_.isString(params.enterprise)) {
      throw new Error(`enterprise should be a string - got ${params.enterprise} (type ${typeof params.enterprise})`);
    }

    if (!_.isUndefined(params.newFeeAddress) && !_.isBoolean(params.newFeeAddress)) {
      throw new Error(
        `newFeeAddress should be a boolean - got ${params.newFeeAddress} (type ${typeof params.newFeeAddress})`
      );
    }
  }

  /**
   * Queries public block explorer to get the next ETH nonce that should be used for the given ETH address
   * @param address
   * @returns {*}
   */
  async getAddressNonce(address: string): Promise<number> {
    // Get nonce for backup key (should be 0)
    let nonce = 0;

    const result = await this.recoveryBlockchainExplorerQuery({
      module: 'account',
      action: 'txlist',
      address,
    });
    if (!result || !Array.isArray(result.result)) {
      throw new Error('Unable to find next nonce from Etherscan, got: ' + JSON.stringify(result));
    }
    const backupKeyTxList = result.result;
    if (backupKeyTxList.length > 0) {
      // Calculate last nonce used
      const outgoingTxs = backupKeyTxList.filter((tx) => tx.from === address);
      nonce = outgoingTxs.length;
    }
    return nonce;
  }

  /**
   * Helper function for recover()
   * This transforms the unsigned transaction information into a format the BitGo offline vault expects
   * @param txInfo
   * @param ethTx
   * @param userKey
   * @param backupKey
   * @param gasPrice
   * @param gasLimit
   * @param eip1559
   * @param replayProtectionOptions
   * @returns {Promise<OfflineVaultTxInfo>}
   */
  async formatForOfflineVault(
    txInfo: UnformattedTxInfo,
    ethTx: EthTxLib.Transaction | EthTxLib.FeeMarketEIP1559Transaction,
    userKey: string,
    backupKey: string,
    gasPrice: Buffer,
    gasLimit: number,
    eip1559?: EIP1559,
    replayProtectionOptions?: ReplayProtectionOptions
  ): Promise<OfflineVaultTxInfo> {
    if (!ethTx.to) {
      throw new Error('Eth tx must have a `to` address');
    }
    const backupHDNode = bip32.fromBase58(backupKey);
    const backupSigningKey = backupHDNode.publicKey;
    const response: OfflineVaultTxInfo = {
      tx: ethTx.serialize().toString('hex'),
      userKey,
      backupKey,
      coin: this.getChain(),
      gasPrice: optionalDeps.ethUtil.bufferToInt(gasPrice).toFixed(),
      gasLimit,
      recipients: [txInfo.recipient],
      walletContractAddress: ethTx.to.toString(),
      amount: txInfo.recipient.amount,
      backupKeyNonce: await this.getAddressNonce(
        `0x${optionalDeps.ethUtil.publicToAddress(backupSigningKey, true).toString('hex')}`
      ),
      eip1559,
      replayProtectionOptions,
    };
    _.extend(response, txInfo);
    response.nextContractSequenceId = response.contractSequenceId;
    return response;
  }

  /**
   * Check whether the gas price passed in by user are within our max and min bounds
   * If they are not set, set them to the defaults
   * @param userGasPrice user defined gas price
   * @returns the gas price to use for this transaction
   */
  setGasPrice(userGasPrice?: number): number {
    if (!userGasPrice) {
      return ethGasConfigs.defaultGasPrice;
    }

    const gasPriceMax = ethGasConfigs.maximumGasPrice;
    const gasPriceMin = ethGasConfigs.minimumGasPrice;
    if (userGasPrice < gasPriceMin || userGasPrice > gasPriceMax) {
      throw new Error(`Gas price must be between ${gasPriceMin} and ${gasPriceMax}`);
    }
    return userGasPrice;
  }
  /**
   * Check whether gas limit passed in by user are within our max and min bounds
   * If they are not set, set them to the defaults
   * @param userGasLimit user defined gas limit
   * @returns the gas limit to use for this transaction
   */
  setGasLimit(userGasLimit?: number): number {
    if (!userGasLimit) {
      return ethGasConfigs.defaultGasLimit;
    }
    const gasLimitMax = ethGasConfigs.maximumGasLimit;
    const gasLimitMin = ethGasConfigs.minimumGasLimit;
    if (userGasLimit < gasLimitMin || userGasLimit > gasLimitMax) {
      throw new Error(`Gas limit must be between ${gasLimitMin} and ${gasLimitMax}`);
    }
    return userGasLimit;
  }

  /**
   * Builds a funds recovery transaction without BitGo
   * @param params
   * @param params.userKey {String} [encrypted] xprv
   * @param params.backupKey {String} [encrypted] xprv or xpub if the xprv is held by a KRS provider
   * @param params.walletPassphrase {String} used to decrypt userKey and backupKey
   * @param params.walletContractAddress {String} the ETH address of the wallet contract
   * @param params.krsProvider {String} necessary if backup key is held by KRS
   * @param params.recoveryDestination {String} target address to send recovered funds to
   */
  async recover(params: RecoverOptions): Promise<RecoveryInfo | OfflineVaultTxInfo> {
    if (_.isUndefined(params.userKey)) {
      throw new Error('missing userKey');
    }

    if (_.isUndefined(params.backupKey)) {
      throw new Error('missing backupKey');
    }

    if (_.isUndefined(params.walletPassphrase) && !params.userKey.startsWith('xpub')) {
      throw new Error('missing wallet passphrase');
    }

    if (_.isUndefined(params.walletContractAddress) || !this.isValidAddress(params.walletContractAddress)) {
      throw new Error('invalid walletContractAddress');
    }

    if (_.isUndefined(params.recoveryDestination) || !this.isValidAddress(params.recoveryDestination)) {
      throw new Error('invalid recoveryDestination');
    }

    const isKrsRecovery = getIsKrsRecovery(params);
    const isUnsignedSweep = getIsUnsignedSweep(params);

    if (isKrsRecovery) {
      checkKrsProvider(this, params.krsProvider, { checkCoinFamilySupport: false });
    }

    // Clean up whitespace from entered values
    let userKey = params.userKey.replace(/\s/g, '');
    const backupKey = params.backupKey.replace(/\s/g, '');

    // Set new eth tx fees (using default config values from platform)

    const gasLimit = new optionalDeps.ethUtil.BN(this.setGasLimit(params.gasLimit));
    const gasPrice = params.eip1559
      ? new optionalDeps.ethUtil.BN(params.eip1559.maxFeePerGas)
      : new optionalDeps.ethUtil.BN(this.setGasPrice(params.gasPrice));
    if (!userKey.startsWith('xpub') && !userKey.startsWith('xprv')) {
      try {
        userKey = this.bitgo.decrypt({
          input: userKey,
          password: params.walletPassphrase,
        });
      } catch (e) {
        throw new Error(`Error decrypting user keychain: ${e.message}`);
      }
    }

    let backupKeyAddress;
    let backupSigningKey;

    if (isKrsRecovery || isUnsignedSweep) {
      const backupHDNode = bip32.fromBase58(backupKey);
      backupSigningKey = backupHDNode.publicKey;
      backupKeyAddress = `0x${optionalDeps.ethUtil.publicToAddress(backupSigningKey, true).toString('hex')}`;
    } else {
      // Decrypt backup private key and get address
      let backupPrv;

      try {
        backupPrv = this.bitgo.decrypt({
          input: backupKey,
          password: params.walletPassphrase,
        });
      } catch (e) {
        throw new Error(`Error decrypting backup keychain: ${e.message}`);
      }

      const backupHDNode = bip32.fromBase58(backupPrv);
      backupSigningKey = backupHDNode.privateKey;
      if (!backupHDNode) {
        throw new Error('no private key');
      }
      backupKeyAddress = `0x${optionalDeps.ethUtil.privateToAddress(backupSigningKey).toString('hex')}`;
    }

    const backupKeyNonce = await this.getAddressNonce(backupKeyAddress);

    // get balance of backupKey to ensure funds are available to pay fees
    const backupKeyBalance = await this.queryAddressBalance(backupKeyAddress);

    const totalGasNeeded = gasPrice.mul(gasLimit);
    const weiToGwei = 10 ** 9;
    if (backupKeyBalance.lt(totalGasNeeded)) {
      throw new Error(
        `Backup key address ${backupKeyAddress} has balance ${(backupKeyBalance / weiToGwei).toString()} Gwei.` +
          `This address must have a balance of at least ${(totalGasNeeded / weiToGwei).toString()}` +
          ` Gwei to perform recoveries. Try sending some ETH to this address then retry.`
      );
    }

    // get balance of wallet and deduct fees to get transaction amount
    const txAmount = await this.queryAddressBalance(params.walletContractAddress);

    // build recipients object
    const recipients = [
      {
        address: params.recoveryDestination,
        amount: txAmount.toString(10),
      },
    ];

    // Get sequence ID using contract call
    // we need to wait between making two etherscan calls to avoid getting banned
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const sequenceId = await this.querySequenceId(params.walletContractAddress);

    let operationHash, signature;
    // Get operation hash and sign it
    if (!isUnsignedSweep) {
      operationHash = this.getOperationSha3ForExecuteAndConfirm(recipients, this.getDefaultExpireTime(), sequenceId);
      signature = Util.ethSignMsgHash(operationHash, Util.xprvToEthPrivateKey(userKey));

      try {
        Util.ecRecoverEthAddress(operationHash, signature);
      } catch (e) {
        throw new Error('Invalid signature');
      }
    }

    const txInfo = {
      recipient: recipients[0],
      expireTime: this.getDefaultExpireTime(),
      contractSequenceId: sequenceId,
      operationHash: operationHash,
      signature: signature,
      gasLimit: gasLimit.toString(10),
    };

    // calculate send data
    const sendMethodArgs = this.getSendMethodArgs(txInfo);
    const methodSignature = optionalDeps.ethAbi.methodID(this.sendMethodName, _.map(sendMethodArgs, 'type'));
    const encodedArgs = optionalDeps.ethAbi.rawEncode(_.map(sendMethodArgs, 'type'), _.map(sendMethodArgs, 'value'));
    const sendData = Buffer.concat([methodSignature, encodedArgs]);

    const txParams = {
      to: params.walletContractAddress,
      nonce: backupKeyNonce,
      value: 0,
      gasPrice: gasPrice,
      gasLimit: gasLimit,
      data: sendData,
      eip1559: params.eip1559,
      replayProtectionOptions: params.replayProtectionOptions,
    };

    // Build contract call and sign it
    let tx = Eth.buildTransaction(txParams);

    if (isUnsignedSweep) {
      return this.formatForOfflineVault(
        txInfo,
        tx,
        userKey,
        backupKey,
        gasPrice,
        gasLimit,
        params.eip1559,
        params.replayProtectionOptions
      );
    }

    if (!isKrsRecovery) {
      tx = tx.sign(backupSigningKey);
    }

    const signedTx: RecoveryInfo = {
      id: optionalDeps.ethUtil.bufferToHex(tx.hash()),
      tx: tx.serialize().toString('hex'),
    };

    if (isKrsRecovery) {
      signedTx.backupKey = backupKey;
      signedTx.coin = this.getChain();
    }

    return signedTx;
  }

  /**
   * Recover an unsupported token from a BitGo multisig wallet
   * This builds a half-signed transaction, for which there will be an admin route to co-sign and broadcast. Optionally
   * the user can set params.broadcast = true and the half-signed tx will be sent to BitGo for cosigning and broadcasting
   * @param params
   * @param params.wallet the wallet to recover the token from
   * @param params.tokenContractAddress the contract address of the unsupported token
   * @param params.recipient the destination address recovered tokens should be sent to
   * @param params.walletPassphrase the wallet passphrase
   * @param params.prv the xprv
   * @param params.broadcast if true, we will automatically submit the half-signed tx to BitGo for cosigning and broadcasting
   */
  async recoverToken(params: RecoverTokenOptions): Promise<RecoverTokenTransaction> {
    if (!_.isObject(params)) {
      throw new Error(`recoverToken must be passed a params object. Got ${params} (type ${typeof params})`);
    }

    if (_.isUndefined(params.tokenContractAddress) || !_.isString(params.tokenContractAddress)) {
      throw new Error(
        `tokenContractAddress must be a string, got ${
          params.tokenContractAddress
        } (type ${typeof params.tokenContractAddress})`
      );
    }

    if (!this.isValidAddress(params.tokenContractAddress)) {
      throw new Error('tokenContractAddress not a valid address');
    }

    if (_.isUndefined(params.wallet) || !(params.wallet instanceof Wallet)) {
      throw new Error(`wallet must be a wallet instance, got ${params.wallet} (type ${typeof params.wallet})`);
    }

    if (_.isUndefined(params.recipient) || !_.isString(params.recipient)) {
      throw new Error(`recipient must be a string, got ${params.recipient} (type ${typeof params.recipient})`);
    }

    if (!this.isValidAddress(params.recipient)) {
      throw new Error('recipient not a valid address');
    }

    if (!optionalDeps.ethUtil.bufferToHex || !optionalDeps.ethAbi.soliditySHA3) {
      throw new Error('ethereum not fully supported in this environment');
    }

    // Get token balance from external API
    const coinSpecific = params.wallet.coinSpecific();
    if (!coinSpecific || !_.isString(coinSpecific.baseAddress)) {
      throw new Error('missing required coin specific property baseAddress');
    }
    const recoveryAmount = await this.queryAddressTokenBalance(params.tokenContractAddress, coinSpecific.baseAddress);

    if (params.broadcast) {
      // We're going to create a normal ETH transaction that sends an amount of 0 ETH to the
      // tokenContractAddress and encode the unsupported-token-send data in the data field
      // #tricksy
      const sendMethodArgs = [
        {
          name: '_to',
          type: 'address',
          value: params.recipient,
        },
        {
          name: '_value',
          type: 'uint256',
          value: recoveryAmount.toString(10),
        },
      ];
      const methodSignature = optionalDeps.ethAbi.methodID('transfer', _.map(sendMethodArgs, 'type'));
      const encodedArgs = optionalDeps.ethAbi.rawEncode(_.map(sendMethodArgs, 'type'), _.map(sendMethodArgs, 'value'));
      const sendData = Buffer.concat([methodSignature, encodedArgs]);

      const broadcastParams: any = {
        address: params.tokenContractAddress,
        amount: '0',
        data: sendData.toString('hex'),
      };

      if (params.walletPassphrase) {
        broadcastParams.walletPassphrase = params.walletPassphrase;
      } else if (params.prv) {
        broadcastParams.prv = params.prv;
      }

      return await params.wallet.send(broadcastParams);
    }

    const recipient = {
      address: params.recipient,
      amount: recoveryAmount.toString(10),
    };

    // This signature will be valid for one week
    const expireTime = Math.floor(new Date().getTime() / 1000) + 60 * 60 * 24 * 7;

    // Get sequence ID. We do this by building a 'fake' eth transaction, so the platform will increment and return us the new sequence id
    // This _does_ require the user to have a non-zero wallet balance
    const { nextContractSequenceId, gasPrice, gasLimit } = (await params.wallet.prebuildTransaction({
      recipients: [
        {
          address: params.recipient,
          amount: '1',
        },
      ],
    })) as any;

    // these recoveries need to be processed by support, but if the customer sends any transactions before recovery is
    // complete the sequence ID will be invalid. artificially inflate the sequence ID to allow more time for processing
    const safeSequenceId = nextContractSequenceId + 1000;

    // Build sendData for ethereum tx
    const operationTypes = ['string', 'address', 'uint', 'address', 'uint', 'uint'];
    const operationArgs = [
      // "ERC20" has been added here so that ether operation hashes, signatures cannot be re-used for tokenSending
      'ERC20',
      new optionalDeps.ethUtil.BN(optionalDeps.ethUtil.stripHexPrefix(recipient.address), 16),
      recipient.amount,
      new optionalDeps.ethUtil.BN(optionalDeps.ethUtil.stripHexPrefix(params.tokenContractAddress), 16),
      expireTime,
      safeSequenceId,
    ];

    const operationHash = optionalDeps.ethUtil.bufferToHex(
      optionalDeps.ethAbi.soliditySHA3(operationTypes, operationArgs)
    );

    const userPrv = await params.wallet.getPrv({
      prv: params.prv,
      walletPassphrase: params.walletPassphrase,
    });

    const signature = Util.ethSignMsgHash(operationHash, Util.xprvToEthPrivateKey(userPrv));

    return {
      halfSigned: {
        recipient: recipient,
        expireTime: expireTime,
        contractSequenceId: safeSequenceId,
        operationHash: operationHash,
        signature: signature,
        gasLimit: gasLimit,
        gasPrice: gasPrice,
        tokenContractAddress: params.tokenContractAddress,
        walletId: params.wallet.id(),
      },
    };
  }

  /**
   * Build arguments to call the send method on the wallet contract
   * @param txInfo
   */
  getSendMethodArgs(txInfo: GetSendMethodArgsOptions): SendMethodArgs[] {
    // Method signature is
    // sendMultiSig(address toAddress, uint value, bytes data, uint expireTime, uint sequenceId, bytes signature)
    return [
      {
        name: 'toAddress',
        type: 'address',
        value: txInfo.recipient.address,
      },
      {
        name: 'value',
        type: 'uint',
        value: txInfo.recipient.amount,
      },
      {
        name: 'data',
        type: 'bytes',
        value: optionalDeps.ethUtil.toBuffer(optionalDeps.ethUtil.addHexPrefix(txInfo.recipient.data || '')),
      },
      {
        name: 'expireTime',
        type: 'uint',
        value: txInfo.expireTime,
      },
      {
        name: 'sequenceId',
        type: 'uint',
        value: txInfo.contractSequenceId,
      },
      {
        name: 'signature',
        type: 'bytes',
        value: optionalDeps.ethUtil.toBuffer(optionalDeps.ethUtil.addHexPrefix(txInfo.signature)),
      },
    ];
  }

  /**
   * Make a query to Etherscan for information such as balance, token balance, solidity calls
   * @param query {Object} key-value pairs of parameters to append after /api
   * @returns {Object} response from Etherscan
   */
  async recoveryBlockchainExplorerQuery(query: Record<string, string>): Promise<any> {
    const token = common.Environments[this.bitgo.getEnv()].etherscanApiToken;
    if (token) {
      query.apikey = token;
    }
    const response = await request.get(common.Environments[this.bitgo.getEnv()].etherscanBaseUrl + '/api').query(query);

    if (!response.ok) {
      throw new Error('could not reach Etherscan');
    }

    if (response.body.status === '0' && response.body.message === 'NOTOK') {
      throw new Error('Etherscan rate limit reached');
    }
    return response.body;
  }

  /**
   * Creates the extra parameters needed to build a hop transaction
   * @param buildParams The original build parameters
   * @returns extra parameters object to merge with the original build parameters object and send to the platform
   */
  async createHopTransactionParams(buildParams: HopTransactionBuildOptions): Promise<HopParams> {
    const wallet = buildParams.wallet;
    const recipients = buildParams.recipients;
    const walletPassphrase = buildParams.walletPassphrase;

    const userKeychain = await this.keychains().get({ id: wallet.keyIds()[0] });
    const userPrv = wallet.getUserPrv({ keychain: userKeychain, walletPassphrase });
    const userPrvBuffer = bip32.fromBase58(userPrv).privateKey;
    if (!userPrvBuffer) {
      throw new Error('invalid userPrv');
    }
    if (!recipients || !Array.isArray(recipients)) {
      throw new Error('expecting array of recipients');
    }

    // Right now we only support 1 recipient
    if (recipients.length !== 1) {
      throw new Error('must send to exactly 1 recipient');
    }
    const recipientAddress = recipients[0].address;
    const recipientAmount = recipients[0].amount;
    const feeEstimateParams = {
      recipient: recipientAddress,
      amount: recipientAmount,
      hop: true,
    };
    const feeEstimate: FeeEstimate = await this.feeEstimate(feeEstimateParams);

    const gasLimit = feeEstimate.gasLimitEstimate;
    const gasPrice = Math.round(feeEstimate.feeEstimate / gasLimit);
    const gasPriceMax = gasPrice * 5;
    // Payment id a random number so its different for every tx
    const paymentId = Math.floor(Math.random() * 10000000000).toString();
    const hopDigest: Buffer = Eth.getHopDigest([
      recipientAddress,
      recipientAmount,
      gasPriceMax.toString(),
      gasLimit.toString(),
      paymentId,
    ]);

    const userReqSig = optionalDeps.ethUtil.addHexPrefix(
      Buffer.from(secp256k1.ecdsaSign(hopDigest, userPrvBuffer).signature).toString('hex')
    );

    return {
      hopParams: {
        gasPriceMax,
        userReqSig,
        paymentId,
      },
      gasLimit,
    };
  }

  /**
   * Validates that the hop prebuild from the HSM is valid and correct
   * @param wallet The wallet that the prebuild is for
   * @param hopPrebuild The prebuild to validate
   * @param originalParams The original parameters passed to prebuildTransaction
   * @returns void
   * @throws Error if The prebuild is invalid
   */
  async validateHopPrebuild(
    wallet: IWallet,
    hopPrebuild: HopPrebuild,
    originalParams?: { recipients: Recipient[] }
  ): Promise<void> {
    const { tx, id, signature } = hopPrebuild;

    // first, validate the HSM signature
    const serverXpub = common.Environments[this.bitgo.getEnv()].hsmXpub;
    const serverPubkeyBuffer: Buffer = bip32.fromBase58(serverXpub).publicKey;
    const signatureBuffer: Buffer = Buffer.from(optionalDeps.ethUtil.stripHexPrefix(signature), 'hex');
    const messageBuffer: Buffer = Buffer.from(
      optionalDeps.ethUtil.padToEven(optionalDeps.ethUtil.stripHexPrefix(id)),
      'hex'
    );

    const sig = new Uint8Array(signatureBuffer.slice(1));
    const isValidSignature: boolean = secp256k1.ecdsaVerify(sig, messageBuffer, serverPubkeyBuffer);
    if (!isValidSignature) {
      throw new Error(
        `Hop txid signature invalid - pub: ${serverXpub}, msg: ${messageBuffer?.toString()}, sig: ${signatureBuffer?.toString()}`
      );
    }

    const builtHopTx = optionalDeps.EthTx.TransactionFactory.fromSerializedData(optionalDeps.ethUtil.toBuffer(tx));
    // If original params are given, we can check them against the transaction prebuild params
    if (!_.isNil(originalParams)) {
      const { recipients } = originalParams;

      // Then validate that the tx params actually equal the requested params
      const originalAmount = new BigNumber(recipients[0].amount);
      const originalDestination: string = recipients[0].address;

      const hopAmount = new BigNumber(optionalDeps.ethUtil.bufferToHex(builtHopTx.value));
      if (!builtHopTx.to) {
        throw new Error(`Transaction does not have a destination address`);
      }
      const hopDestination = builtHopTx.to.toString();
      if (!hopAmount.eq(originalAmount)) {
        throw new Error(`Hop amount: ${hopAmount} does not equal original amount: ${originalAmount}`);
      }
      if (hopDestination.toLowerCase() !== originalDestination.toLowerCase()) {
        throw new Error(`Hop destination: ${hopDestination} does not equal original recipient: ${hopDestination}`);
      }
    }

    if (!builtHopTx.verifySignature()) {
      // We dont want to continue at all in this case, at risk of ETH being stuck on the hop address
      throw new Error(`Invalid hop transaction signature, txid: ${id}`);
    }
    if (optionalDeps.ethUtil.addHexPrefix(builtHopTx.hash().toString('hex')) !== id) {
      throw new Error(`Signed hop txid does not equal actual txid`);
    }
  }

  /**
   * Gets the hop digest for the user to sign. This is validated in the HSM to prove that the user requested this tx
   * @param paramsArr The parameters to hash together for the digest
   */
  private static getHopDigest(paramsArr: string[]): Buffer {
    const hash = new Keccak('keccak256');
    hash.update([Eth.hopTransactionSalt, ...paramsArr].join('$'));
    return hash.digest();
  }

  /**
   * Modify prebuild before sending it to the server. Add things like hop transaction params
   * @param buildParams The whitelisted parameters for this prebuild
   * @param buildParams.hop True if this should prebuild a hop tx, else false
   * @param buildParams.recipients The recipients array of this transaction
   * @param buildParams.wallet The wallet sending this tx
   * @param buildParams.walletPassphrase the passphrase for this wallet
   */
  async getExtraPrebuildParams(buildParams: BuildOptions): Promise<BuildOptions> {
    if (
      !_.isUndefined(buildParams.hop) &&
      buildParams.hop &&
      !_.isUndefined(buildParams.wallet) &&
      !_.isUndefined(buildParams.recipients) &&
      !_.isUndefined(buildParams.walletPassphrase)
    ) {
      if (this instanceof Erc20Token) {
        throw new Error(
          `Hop transactions are not enabled for ERC-20 tokens, nor are they necessary. Please remove the 'hop' parameter and try again.`
        );
      }
      return (await this.createHopTransactionParams({
        wallet: buildParams.wallet,
        recipients: buildParams.recipients,
        walletPassphrase: buildParams.walletPassphrase,
      })) as any;
    }
    return {};
  }

  /**
   * Modify prebuild after receiving it from the server. Add things like nlocktime
   */
  async postProcessPrebuild(params: TransactionPrebuild): Promise<TransactionPrebuild> {
    if (!_.isUndefined(params.hopTransaction) && !_.isUndefined(params.wallet) && !_.isUndefined(params.buildParams)) {
      await this.validateHopPrebuild(params.wallet, params.hopTransaction, params.buildParams);
    }
    return params;
  }

  /**
   * Coin-specific things done before signing a transaction, i.e. verification
   * @param params
   */
  async presignTransaction(params: PresignTransactionOptions): Promise<PresignTransactionOptions> {
    if (!_.isUndefined(params.hopTransaction) && !_.isUndefined(params.wallet) && !_.isUndefined(params.buildParams)) {
      await this.validateHopPrebuild(params.wallet, params.hopTransaction);
    }
    return params;
  }

  /**
   * Fetch fee estimate information from the server
   * @param {Object} params The params passed into the function
   * @param {Boolean} [params.hop] True if we should estimate fee for a hop transaction
   * @param {String} [params.recipient] The recipient of the transaction to estimate a send to
   * @param {String} [params.data] The ETH tx data to estimate a send for
   * @returns {Object} The fee info returned from the server
   */
  async feeEstimate(params: FeeEstimateOptions): Promise<FeeEstimate> {
    const query: FeeEstimateOptions = {};
    if (params && params.hop) {
      query.hop = params.hop;
    }
    if (params && params.recipient) {
      query.recipient = params.recipient;
    }
    if (params && params.data) {
      query.data = params.data;
    }
    if (params && params.amount) {
      query.amount = params.amount;
    }

    return await this.bitgo.get(this.url('/tx/fee')).query(query).result();
  }

  /**
   * Generate secp256k1 key pair
   *
   * @param seed
   * @returns {Object} object with generated pub and prv
   */
  generateKeyPair(seed: Buffer): KeyPair {
    if (!seed) {
      // An extended private key has both a normal 256 bit private key and a 256
      // bit chain code, both of which must be random. 512 bits is therefore the
      // maximum entropy and gives us maximum security against cracking.
      seed = randomBytes(512 / 8);
    }
    const extendedKey = bip32.fromSeed(seed);
    const xpub = extendedKey.neutered().toBase58();
    return {
      pub: xpub,
      prv: extendedKey.toBase58(),
    };
  }

  async parseTransaction(params: ParseTransactionOptions): Promise<ParsedTransaction> {
    return {};
  }

  /**
   * Make sure an address is a wallet address and throw an error if it's not.
   * @param {Object} params
   * @param {String} params.address The derived address string on the network
   * @param {Object} params.coinSpecific Coin-specific details for the address such as a forwarderVersion
   * @param {String} params.baseAddress The base address of the wallet on the network
   * @throws {InvalidAddressError}
   * @throws {InvalidAddressVerificationObjectPropertyError}
   * @throws {UnexpectedAddressError}
   * @returns {Boolean} True iff address is a wallet address
   */
  isWalletAddress(params: VerifyEthAddressOptions): boolean {
    const ethUtil = optionalDeps.ethUtil;

    let expectedAddress;
    let actualAddress;

    const { address, coinSpecific, baseAddress, impliedForwarderVersion = coinSpecific?.forwarderVersion } = params;

    if (address && !this.isValidAddress(address)) {
      throw new InvalidAddressError(`invalid address: ${address}`);
    }

    // base address is required to calculate the salt which is used in calculateForwarderV1Address method
    if (_.isUndefined(baseAddress) || !this.isValidAddress(baseAddress)) {
      throw new InvalidAddressError('invalid base address');
    }

    if (!_.isObject(coinSpecific)) {
      throw new InvalidAddressVerificationObjectPropertyError(
        'address validation failure: coinSpecific field must be an object'
      );
    }

    if (impliedForwarderVersion === 0) {
      return true;
    } else {
      const ethNetwork = this.getNetwork();
      const forwarderFactoryAddress = ethNetwork?.forwarderFactoryAddress as string;
      const forwarderImplementationAddress = ethNetwork?.forwarderImplementationAddress as string;

      const initcode = getProxyInitcode(forwarderImplementationAddress);
      const saltBuffer = ethUtil.setLengthLeft(
        Buffer.from(ethUtil.padToEven(ethUtil.stripHexPrefix(coinSpecific.salt || '')), 'hex'),
        32
      );

      // Hash the wallet base address with the given salt, so the address directly relies on the base address
      const calculationSalt = optionalDeps.ethUtil.bufferToHex(
        optionalDeps.ethAbi.soliditySHA3(['address', 'bytes32'], [baseAddress, saltBuffer])
      );

      expectedAddress = calculateForwarderV1Address(forwarderFactoryAddress, calculationSalt, initcode);
      actualAddress = address;
    }

    if (expectedAddress !== actualAddress) {
      throw new UnexpectedAddressError(`address validation failure: expected ${expectedAddress} but got ${address}`);
    }

    return true;
  }

  verifyCoin(txPrebuild: TransactionPrebuild): boolean {
    return txPrebuild.coin === this.getChain();
  }

  /**
   * Verify that a transaction prebuild complies with the original intention
   *
   * @param params
   * @param params.txParams params object passed to send
   * @param params.txPrebuild prebuild object returned by server
   * @param params.wallet Wallet object to obtain keys to verify against
   * @returns {boolean}
   */
  async verifyTransaction(params: VerifyEthTransactionOptions): Promise<boolean> {
    const ethNetwork = this.getNetwork();
    const { txParams, txPrebuild, wallet } = params;
    if (!txParams?.recipients || !txPrebuild?.recipients || !wallet) {
      throw new Error(`missing params`);
    }
    if (txParams.hop && txParams.recipients.length > 1) {
      throw new Error(`tx cannot be both a batch and hop transaction`);
    }
    if (txPrebuild.recipients.length !== 1) {
      throw new Error(`txPrebuild should only have 1 recipient but ${txPrebuild.recipients.length} found`);
    }
    if (txParams.hop && txPrebuild.hopTransaction) {
      // Check recipient amount for hop transaction
      if (txParams.recipients.length !== 1) {
        throw new Error(`hop transaction only supports 1 recipient but ${txParams.recipients.length} found`);
      }

      // Check tx sends to hop address
      const decodedHopTx = optionalDeps.EthTx.TransactionFactory.fromSerializedData(
        optionalDeps.ethUtil.toBuffer(txPrebuild.hopTransaction.tx)
      );
      const expectedHopAddress = optionalDeps.ethUtil.stripHexPrefix(decodedHopTx.getSenderAddress().toString());
      const actualHopAddress = optionalDeps.ethUtil.stripHexPrefix(txPrebuild.recipients[0].address);
      if (expectedHopAddress.toLowerCase() !== actualHopAddress.toLowerCase()) {
        throw new Error('recipient address of txPrebuild does not match hop address');
      }

      // Convert TransactionRecipient array to Recipient array
      const recipients: Recipient[] = txParams.recipients.map((r) => {
        return {
          address: r.address,
          amount: typeof r.amount === 'number' ? r.amount.toString() : r.amount,
        };
      });

      // Check destination address and amount
      await this.validateHopPrebuild(wallet, txPrebuild.hopTransaction, { recipients });
    } else if (txParams.recipients.length > 1) {
      // Check total amount for batch transaction
      let expectedTotalAmount = new BigNumber(0);
      for (let i = 0; i < txParams.recipients.length; i++) {
        expectedTotalAmount = expectedTotalAmount.plus(txParams.recipients[i].amount);
      }
      if (!expectedTotalAmount.isEqualTo(txPrebuild.recipients[0].amount)) {
        throw new Error(
          'batch transaction amount in txPrebuild received from BitGo servers does not match txParams supplied by client'
        );
      }

      // Check batch transaction is sent to the batcher contract address for the chain
      const batcherContractAddress = ethNetwork?.batcherContractAddress;
      if (
        !batcherContractAddress ||
        batcherContractAddress.toLowerCase() !== txPrebuild.recipients[0].address.toLowerCase()
      ) {
        throw new Error('recipient address of txPrebuild does not match batcher address');
      }
    } else {
      // Check recipient address and amount for normal transaction
      if (txParams.recipients.length !== 1) {
        throw new Error(`normal transaction only supports 1 recipient but ${txParams.recipients.length} found`);
      }
      const expectedAmount = new BigNumber(txParams.recipients[0].amount);
      if (!expectedAmount.isEqualTo(txPrebuild.recipients[0].amount)) {
        throw new Error(
          'normal transaction amount in txPrebuild received from BitGo servers does not match txParams supplied by client'
        );
      }
      if (
        this.isETHAddress(txParams.recipients[0].address) &&
        txParams.recipients[0].address !== txPrebuild.recipients[0].address
      ) {
        throw new Error('destination address in normal txPrebuild does not match that in txParams supplied by client');
      }
    }
    // Check coin is correct for all transaction types
    if (!this.verifyCoin(txPrebuild)) {
      throw new Error(`coin in txPrebuild did not match that in txParams supplied by client`);
    }
    return true;
  }

  supportsStaking(): boolean {
    return true;
  }

  private isETHAddress(address: string): boolean {
    return !!address.match(/0x[a-fA-F0-9]{40}/);
  }
}
