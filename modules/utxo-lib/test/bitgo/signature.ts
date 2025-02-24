import * as assert from 'assert';
import * as bip32 from 'bip32';

import { script as bscript, classify, TxOutput } from '../../src';
import { getNetworkList, getNetworkName, isBitcoin, isMainnet, Network, networks } from '../../src/networks';

import { ScriptType, ScriptType2Of3, scriptTypes2Of3 } from '../../src/bitgo/outputScripts';
import {
  verifySignature,
  UtxoTransaction,
  parseSignatureScript,
  getSignatureVerifications,
  verifySignatureWithPublicKeys,
  verifySignatureWithPublicKey,
  isPlaceholderSignature,
  toTNumber,
} from '../../src/bitgo';

import * as fixtureUtil from '../fixture.util';

import { fixtureKeys } from '../integration_local_rpc/generate/fixtures';
import {
  defaultTestOutputAmount,
  getFullSignedTransaction2Of3,
  getFullSignedTransactionP2shP2pk,
  getHalfSignedTransaction2Of3,
  getPrevOutputs,
  getSignKeyCombinations,
  getUnsignedTransaction2Of3,
} from '../transaction_util';
import { getTransactionWithHighS } from './signatureModify';

async function readFixture<T>(
  network: Network,
  scriptType: ScriptType2Of3 | 'p2shP2pk',
  name: string,
  defaultValue: T
): Promise<T> {
  return await fixtureUtil.readFixture(
    `${__dirname}/fixtures/signature/${getNetworkName(network)}/${scriptType}/${name}.json`,
    defaultValue
  );
}

function keyName(k: bip32.BIP32Interface): string | undefined {
  return ['user', 'backup', 'bitgo'][fixtureKeys.indexOf(k)];
}

function runTestCheckScriptStructure<TNumber extends number | bigint = number>(
  network: Network,
  scriptType: ScriptType2Of3 | 'p2shP2pk',
  signer1: bip32.BIP32Interface,
  signer2?: bip32.BIP32Interface,
  amountType: 'number' | 'bigint' = 'number'
) {
  it(`has expected script structure [${getNetworkName(network)} ${scriptType} ${keyName(signer1)} ${
    signer2 ? keyName(signer2) : ''
  } ${amountType}]`, async function () {
    let tx;

    if (scriptType === 'p2shP2pk') {
      tx = getFullSignedTransactionP2shP2pk<TNumber>(fixtureKeys, signer1, network, amountType);
    } else {
      if (!signer2) {
        throw new Error(`must set cosigner`);
      }
      tx = getFullSignedTransaction2Of3<TNumber>(fixtureKeys, signer1, signer2, scriptType, network, amountType);
    }

    const { script, witness } = tx.ins[0];
    const scriptDecompiled = bscript.decompile(script);
    if (!scriptDecompiled) {
      throw new Error();
    }
    const scriptASM = bscript.toASM(script).split(' ');
    const classifyInput = classify.input(script);
    const classifyWitness = classify.witness(witness);

    let pubScript;
    let classifyPubScript;
    let pubScriptASM;

    let tapscript;
    let tapscriptASM;
    let classifyTapscript;

    if (classifyInput === 'scripthash' || classifyWitness === 'witnessscripthash') {
      if (witness.length) {
        pubScript = witness[witness.length - 1];
      } else {
        pubScript = scriptDecompiled[scriptDecompiled.length - 1] as Buffer;
      }

      classifyPubScript = classify.output(pubScript);
      pubScriptASM = bscript.toASM(pubScript).split(' ');
    } else if (classifyWitness === 'taproot') {
      tapscript = witness[witness.length - 2];
      classifyTapscript = classify.output(tapscript);
      tapscriptASM = bscript.toASM(tapscript).split(' ');
    }

    const structure = {
      publicKeys: fixtureKeys.map((k) => k.publicKey.toString('hex')),
      script: script?.toString('hex'),
      witness: witness?.map((w) => w.toString('hex')),
      scriptASM,
      pubScriptASM,
      tapscriptASM,
      classifyInput,
      classifyWitness,
      classifyPubScript,
      classifyTapscript,
    };

    const fixtureName = ['structure', keyName(signer1), signer2 ? keyName(signer2) : 'none'].join('-');
    fixtureUtil.assertEqualJSON(structure, await readFixture(network, scriptType, fixtureName, structure));
  });
}

function runTestParseScript<TNumber extends number | bigint = number>(
  network: Network,
  scriptType: ScriptType,
  k1: bip32.BIP32Interface,
  k2: bip32.BIP32Interface,
  amountType: 'number' | 'bigint' = 'number'
) {
  async function testParseSignedInputs(
    tx: UtxoTransaction<TNumber>,
    name: string,
    expectedScriptType: string | undefined,
    { expectedPlaceholderSignatures }: { expectedPlaceholderSignatures: number }
  ) {
    const parsed = parseSignatureScript(tx.ins[0]);
    assert.strictEqual(parsed.scriptType, expectedScriptType);
    fixtureUtil.assertEqualJSON(
      parsed,
      await readFixture(network, scriptType, ['parsed', keyName(k1), keyName(k2), name].join('-'), parsed)
    );

    if (!parsed.scriptType) {
      return;
    }

    switch (parsed.scriptType) {
      case 'p2shP2pk':
        // we don't parse the signature for this script type
        break;
      case 'p2sh':
      case 'p2shP2wsh':
      case 'p2wsh':
      case 'p2tr':
        assert.strictEqual(
          parsed.signatures.filter((s) => isPlaceholderSignature(s)).length,
          expectedPlaceholderSignatures
        );
        break;
      default:
        throw new Error(`unexpected scriptType ${parsed.scriptType}`);
    }
  }

  if (scriptType !== 'p2shP2pk') {
    it(`parses half-signed inputs [${getNetworkName(network)} ${scriptType} ${amountType}]`, async function () {
      await testParseSignedInputs(
        getHalfSignedTransaction2Of3<TNumber>(fixtureKeys, k1, k2, scriptType, network, amountType),
        'halfSigned',
        scriptType,
        { expectedPlaceholderSignatures: scriptType === 'p2tr' ? 1 : 2 }
      );
    });
  }

  it(`parses full-signed inputs [${getNetworkName(network)} ${scriptType} ${amountType}]`, async function () {
    if (scriptType === 'p2shP2pk') {
      await testParseSignedInputs(
        getFullSignedTransactionP2shP2pk<TNumber>(fixtureKeys, k1, network, amountType),
        'fullSigned',
        scriptType,
        { expectedPlaceholderSignatures: 0 }
      );
    } else {
      await testParseSignedInputs(
        getFullSignedTransaction2Of3<TNumber>(fixtureKeys, k1, k2, scriptType, network, amountType),
        'fullSigned',
        scriptType,
        { expectedPlaceholderSignatures: 0 }
      );
    }
  });
}

function assertVerifySignatureEquals<TNumber extends number | bigint>(
  tx: UtxoTransaction<TNumber>,
  prevOutputs: TxOutput<TNumber>[],
  value: boolean,
  testOutputAmount: TNumber,
  verificationSettings?: {
    publicKey?: Buffer;
    signatureIndex?: number;
  }
) {
  tx.ins.forEach((input, i) => {
    assert.doesNotThrow(() => {
      getSignatureVerifications(tx, i, testOutputAmount, verificationSettings, prevOutputs);
    });
    assert.strictEqual(
      verifySignature(tx, i, testOutputAmount, verificationSettings, prevOutputs),
      value,
      JSON.stringify(verificationSettings)
    );
    if (verificationSettings?.signatureIndex === undefined && verificationSettings?.publicKey) {
      assert.strictEqual(verifySignatureWithPublicKey(tx, i, prevOutputs, verificationSettings.publicKey), value);
    }
  });
}

function checkSignTransaction<TNumber extends number | bigint>(
  tx: UtxoTransaction<TNumber>,
  scriptType: ScriptType2Of3,
  signKeys: bip32.BIP32Interface[],
  testOutputAmount: TNumber
) {
  const prevOutputs = getPrevOutputs<TNumber>(scriptType, testOutputAmount) as TxOutput<TNumber>[];

  // return true iff there are any valid signatures at all
  assertVerifySignatureEquals<TNumber>(tx, prevOutputs, signKeys.length > 0, testOutputAmount);

  fixtureKeys.forEach((k) => {
    // if publicKey is given, return true iff it is included in signKeys
    assertVerifySignatureEquals<TNumber>(tx, prevOutputs, signKeys.includes(k), testOutputAmount, {
      publicKey: k.publicKey,
    });
  });

  // When transactions are signed, the signatures have the same order as the public keys in the outputScript.
  const orderedSigningKeys = fixtureKeys.filter((fixtureKey) => signKeys.includes(fixtureKey));

  [0, 1, 2].forEach((signatureIndex) => {
    if (scriptType === 'p2tr') {
      // signatureIndex parameter not support for p2tr verification
      return;
    }
    fixtureKeys.forEach((k) => {
      // If no public key is given, return true iff any valid signature with given index exists.
      assertVerifySignatureEquals<TNumber>(tx, prevOutputs, signatureIndex < signKeys.length, testOutputAmount, {
        signatureIndex,
      });

      // If publicKey and signatureIndex are provided only return if both match.
      assertVerifySignatureEquals<TNumber>(
        tx,
        prevOutputs,
        signatureIndex === orderedSigningKeys.indexOf(k),
        testOutputAmount,
        {
          publicKey: k.publicKey,
          signatureIndex,
        }
      );
    });
  });

  tx.ins.forEach((input, i) => {
    const signatureCount = (res: boolean[]) => res.reduce((sum, b) => sum + (b ? 1 : 0), 0);
    const pubkeys = fixtureKeys.map((k) => k.publicKey);
    const verifyResult = verifySignatureWithPublicKeys(tx, i, prevOutputs, pubkeys);
    assert.deepStrictEqual(
      verifyResult,
      fixtureKeys.map((k) => signKeys.includes(k))
    );
    assert.strictEqual(signatureCount(verifyResult), signKeys.length);

    if (signKeys.length > 0) {
      getTransactionWithHighS(tx, i).forEach((txWithHighS) => {
        assert.strictEqual(
          signatureCount(verifySignatureWithPublicKeys<TNumber>(txWithHighS, i, prevOutputs, pubkeys)),
          signKeys.length - 1
        );
      });
    }
  });
}

function runTestCheckSignatureVerify<TNumber extends number | bigint = number>(
  network: Network,
  scriptType: ScriptType2Of3,
  k1?: bip32.BIP32Interface,
  k2?: bip32.BIP32Interface,
  amountType: 'number' | 'bigint' = 'number'
) {
  if (k1 && k2) {
    describe(`verifySignature
${getNetworkName(network)} ${scriptType} ${keyName(k1)} ${keyName(k2)} ${amountType}`, function () {
      it(`verifies half-signed`, function () {
        checkSignTransaction(
          getHalfSignedTransaction2Of3<TNumber>(fixtureKeys, k1, k2, scriptType, network, amountType),
          scriptType,
          [k1],
          toTNumber<TNumber>(defaultTestOutputAmount, amountType)
        );
      });

      it(`verifies full-signed`, function () {
        checkSignTransaction(
          getFullSignedTransaction2Of3<TNumber>(fixtureKeys, k1, k2, scriptType, network, amountType),
          scriptType,
          [k1, k2],
          toTNumber<TNumber>(defaultTestOutputAmount, amountType)
        );
      });
    });
  } else {
    describe(`verifySignature ${getNetworkName(network)} ${scriptType} ${amountType} unsigned`, function () {
      it(`verifies unsigned`, function () {
        checkSignTransaction(
          getUnsignedTransaction2Of3<TNumber>(fixtureKeys, scriptType, network, amountType),
          scriptType,
          [],
          toTNumber<TNumber>(defaultTestOutputAmount, amountType)
        );
      });
    });
  }
}

describe('Signature (scriptTypes2Of3)', function () {
  getNetworkList()
    .filter(isMainnet)
    // The signing and verification methods are largely network-independent so let's focus on a
    // single network to reduce test time.
    // During development it might make sense to test all networks.
    .filter(isBitcoin)
    .forEach((network) => {
      scriptTypes2Of3.forEach((scriptType) => {
        runTestCheckSignatureVerify(network, scriptType);

        getSignKeyCombinations(2).map(([k1, k2]) => {
          runTestCheckSignatureVerify(network, scriptType, k1, k2);
          runTestCheckScriptStructure(network, scriptType, k1, k2);
          runTestParseScript(network, scriptType, k1, k2);
        });
      });
      scriptTypes2Of3.forEach((scriptType) => {
        runTestCheckSignatureVerify<bigint>(network, scriptType, undefined, undefined, 'bigint');

        getSignKeyCombinations(2).map(([k1, k2]) => {
          runTestCheckSignatureVerify<bigint>(network, scriptType, k1, k2, 'bigint');
          runTestCheckScriptStructure<bigint>(network, scriptType, k1, k2, 'bigint');
          runTestParseScript<bigint>(network, scriptType, k1, k2, 'bigint');
        });
      });
    });
});

describe('Signature (p2shP2pk)', function () {
  it('sign and parse', function () {
    const signedTransaction = getFullSignedTransactionP2shP2pk(fixtureKeys, fixtureKeys[0], networks.bitcoin);

    signedTransaction.ins.forEach((input) => {
      assert.deepStrictEqual(parseSignatureScript(input), {
        scriptType: 'p2shP2pk',
        inputClassification: 'scripthash',
        isSegwitInput: false,
        p2shOutputClassification: 'pubkey',
      });
    });
  });

  runTestCheckScriptStructure(networks.bitcoin, 'p2shP2pk', fixtureKeys[0]);
  runTestCheckScriptStructure<bigint>(networks.bitcoin, 'p2shP2pk', fixtureKeys[0], undefined, 'bigint');
});
