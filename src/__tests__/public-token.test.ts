// tslint:disable:no-console
import { proofs } from "@aztec/dev-utils"
import * as noteAccess from "@aztec/note-access"
const { metadata: metaDataConstructor } = noteAccess
import secp256k1 from "@aztec/secp256k1"
import {
    BurnProof,
    JoinSplitProof,
    MintProof,
    note,
} from "aztec.js"
import {ethers, Signer} from "ethers"
import nacl from "tweetnacl"
import {
    AZTEC_JS_DEFAULT_METADATA_PREFIX_LENGTH,
    AZTEC_JS_METADATA_PREFIX_LENGTH,
    METADATA_AZTEC_DATA_LENGTH
} from "../chain/aztec/constants"
import { EncryptedViewingKey } from "../chain/aztec/EncryptedViewingKey"
import { compilerOutput as zkAssetLinkedTokenCompilerOutput } from "../chain/contracts/ZkAssetLinkedTokenContract"
import AceMigator from "../chain/migration/1_ace"
import SimpleTokenMigator from "../chain/migration/2_simpleToken"
import migratorFactory, { Migrator } from "../chain/migration/migrator"
import { ACE, SimpleToken, ZkAssetLinkedToken } from "../chain/types"
import { WalletSigner } from "../chain/wallet/WalletSigner"
import configPromise from "../config/index"
import { EthersMatchers } from "../utils/jest"
import {
    bytesFixed,
    ethereumAddress,
    transactionHash,
} from "../utils/regEx"

jest.setTimeout(60000) // timeout for each test in milliseconds
// Extend the Jest matchers with Ethers BigNumber matchers like toEqualBN
expect.extend(EthersMatchers)

const issuer = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000001"
)
const distributor = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000002"
)
const bank1 = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000003"
)
const bank2 = secp256k1.accountFromPrivateKey(
  "0x0000000000000000000000000000000000000000000000000000000000000004"
)
const user1 = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000005"
)
const user2 = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000006"
)
const regulator = secp256k1.accountFromPrivateKey(
  "0x0000000000000000000000000000000000000000000000000000000000000007"
)

describe("confidentialMint, confidentialTransfer, withdraw, public transfer, deposit, confidentialTransfer and confidentialBurn", () => {
    let aceContract: ACE
    let migrator: Migrator
    let issuerSigner: Signer
    let distributorSigner: Signer
    let bank1Signer: Signer
    let bank2Signer: Signer
    let user1Signer: Signer
    let user2Signer: Signer
    let issuerZkAsset: ZkAssetLinkedToken
    let distributorZkAsset: ZkAssetLinkedToken
    let bank1ZkAsset: ZkAssetLinkedToken
    let bank2ZkAsset: ZkAssetLinkedToken
    let user2ZkAsset: ZkAssetLinkedToken
    let publicToken: SimpleToken
    let user1PublicToken: SimpleToken
    let user2PublicToken: SimpleToken
    const regulatorLinkedKeyPair = nacl.box.keyPair()
    const regulatorLinkedAccount = {
        address: regulator.address,
        linkedPublicKey: ethers.utils.hexlify(
          regulatorLinkedKeyPair.publicKey
        ),
    }
    let lastMintCounterNote

    beforeAll(async () => {
        const config = await configPromise
        if (!config?.chain?.wallet) {
            throw Error(`Failed to load config for chain.wallet.`)
        }
        const issuerWallet = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: issuer.privateKey,
        })
        migrator = await migratorFactory(issuerWallet)
        issuerSigner = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: issuer.privateKey,
        })
        distributorSigner = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: distributor.privateKey,
        })
        bank1Signer = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: bank1.privateKey,
        })
        bank2Signer = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: bank2.privateKey,
        })
        user1Signer = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: user1.privateKey,
        })
        user2Signer = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: user2.privateKey,
        })
    })
    describe('Deploy contracts', () => {
        test("Deploy proof contracts and ACE", async () => {
            aceContract = await AceMigator(migrator)
            expect(aceContract.address).toMatch(ethereumAddress)
        })
        test("Deploy public ERC20 token", async () => {
            publicToken = await SimpleTokenMigator(migrator)
            expect(publicToken.address).toMatch(ethereumAddress)
            expect(publicToken).not.toEqual(aceContract.address)
            user1PublicToken = publicToken.connect(user1Signer)
            user2PublicToken = publicToken.connect(user2Signer)

            expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(0)
            expect(await publicToken.totalSupply()).toEqualBN(0)
        })
        test("Deploy a zero-knowledge asset linked to token", async () => {
            issuerZkAsset = await migrator.deploy<ZkAssetLinkedToken>(
                zkAssetLinkedTokenCompilerOutput,
                aceContract.address,
                publicToken.address,
                1
            )
            expect(issuerZkAsset.address).toMatch(ethereumAddress)
            distributorZkAsset = issuerZkAsset.connect(distributorSigner)
            bank1ZkAsset = issuerZkAsset.connect(bank1Signer)
            bank2ZkAsset = issuerZkAsset.connect(bank2Signer)
            user2ZkAsset = issuerZkAsset.connect(user2Signer)

            // Check the zk asset is registered in the ACE note registry
            const registry = await aceContract.getRegistry(issuerZkAsset.address)
            expect(registry.linkedToken).toEqual(publicToken.address)
            expect(registry.scalingFactor).toEqualBN(1)
            expect(registry.totalSupplemented).toEqualBN(0)
            expect(registry.totalSupply).toEqualBN(0)
        })
        test("Add zk-asset as minter of public tokens", async () => {
            const tx = await publicToken.addMinter(issuerZkAsset.address)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(await publicToken.isMinter(issuerZkAsset.address)).toBeTruthy()
        })
    })
    describe("No masked receivers", () => {
        let distributor1Note1
        let distributor1Note2
        let bank1Note1
        let bank1Note2
        let bank2Note1
        let bank2Note2
        let issuerNote1
        test("Issuer confidential mint 100,000 to distributor", async () => {
            distributor1Note1 = await note.create(
              distributor.publicKey,
              100000,
              [regulatorLinkedAccount]
            )
            // note owner
            expect(distributor1Note1.owner).toEqual(distributor.address)
            // note value
            expect(distributor1Note1.k.toNumber()).toEqual(100000)

            lastMintCounterNote = await note.createZeroValueNote()
            expect(lastMintCounterNote.k.toNumber()).toEqual(0)

            const mintProof = new MintProof(
              lastMintCounterNote,  // previous sum of all notes
              distributor1Note1,    // new sum of all notes
              [distributor1Note1],  // new minted notes
              issuer.address        // sender
            )
            const mintData = mintProof.encodeABI()
            const tx = await issuerZkAsset.confidentialMint(
              proofs.MINT_PROOF,
              mintData
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            lastMintCounterNote = distributor1Note1

            expect(receipt.events).toHaveLength(2)
            expect(receipt.events[0].event).toEqual("CreateNote")
            expect(receipt.events[1].event).toEqual(
              "UpdateTotalMinted"
            )
            expect(receipt.events[0].args.owner).toEqual(
              distributor.address
            )
            expect(receipt.events[0].args.noteHash).toEqual(
              distributor1Note1.noteHash
            )
            const onChainNote = await aceContract.getNote(
              issuerZkAsset.address,
              distributor1Note1.noteHash
            )
            expect(onChainNote.status).toEqual(1) // unspent
            expect(onChainNote.noteOwner).toEqual(distributor.address)

            // check the registry balances
            const registry = await aceContract.getRegistry(distributorZkAsset.address)
            expect(registry.totalSupply).toEqualBN(0)
            expect(registry.totalSupplemented).toEqualBN(0)

            expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(distributor.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(0)
            expect(await publicToken.totalSupply()).toEqualBN(0)
        })
        describe.skip("Decrypt the output note from the CreateNote event from the confidential mint transaction", () => {
            let eventArgs
            test("Distributor gets the CreateNote event", async () => {
                const filter = distributorZkAsset.filters.CreateNote(
                  distributor.address,
                  null,
                  null
                )
                const events = await distributorZkAsset.queryFilter(filter)
                expect(events).toHaveLength(1)
                expect(events[0].event).toEqual("CreateNote")
                eventArgs = events[0].args
                expect(eventArgs.owner).toEqual(distributor.address)
                expect(eventArgs.noteHash).toEqual(distributor1Note1.noteHash)
            })
            test("Distributor can decrypt output note", async () => {
                const eventNote = await note.fromEventLog(
                  eventArgs.metadata.slice(0, METADATA_AZTEC_DATA_LENGTH + 2),
                  distributor.privateKey
                )
                expect(eventNote.noteHash).toEqual(distributor1Note1.noteHash)
                expect(eventNote.k.toNumber()).toEqual(100000)
                expect(eventNote.owner).toEqual(distributor.address)
            })
            test("Regulator can decrypt output note using viewing key in metadata from the original output note", async () => {
                const metadataObj = metaDataConstructor(distributor1Note1.metaData.slice(
                  AZTEC_JS_DEFAULT_METADATA_PREFIX_LENGTH + 2
                ))
                const allowedAccess = metadataObj.getAccess(regulator.address)
                const encryptedViewingKey = allowedAccess.viewingKey
                const viewingKey = EncryptedViewingKey.fromEncryptedKey(
                  encryptedViewingKey
                )
                const regulatorDecryptedViewingKey = viewingKey.decrypt(regulatorLinkedKeyPair.secretKey)
                expect(regulatorDecryptedViewingKey).toMatch(bytesFixed(69))
                const derivedNote = await note.fromViewKey(
                  regulatorDecryptedViewingKey
                )
                expect(derivedNote.k.toNumber()).toEqual(100000)
            })
            test("Regulator can decrypt output note using viewing key in metadata from CreateNote event", async () => {
                const metadataObj = metaDataConstructor(eventArgs.metadata.slice(
                  AZTEC_JS_METADATA_PREFIX_LENGTH +
                  AZTEC_JS_DEFAULT_METADATA_PREFIX_LENGTH
                ))
                const allowedAccess = metadataObj.getAccess(regulator.address)
                const encryptedViewingKey = allowedAccess.viewingKey
                const viewingKey = EncryptedViewingKey.fromEncryptedKey(
                  encryptedViewingKey
                )
                const regulatorDecryptedViewingKey = viewingKey.decrypt(regulatorLinkedKeyPair.secretKey)
                expect(regulatorDecryptedViewingKey).toMatch(bytesFixed(69))
                const derivedNote = await note.fromViewKey(
                  regulatorDecryptedViewingKey
                )
                expect(derivedNote.k.toNumber()).toEqual(100000)
            })
            test("Bank 1 can not decrypt output note using private key", async () => {
                expect.assertions(2)
                try {
                    await note.fromEventLog(
                      eventArgs.metadata.slice(0, METADATA_AZTEC_DATA_LENGTH + 2),
                      bank1.privateKey
                    )
                } catch (err) {
                    expect(err).toBeInstanceOf(Error)
                    expect(err.message).toEqual('could not find k!')
                }
            })
        })
        test("Distributor confidential transfer 100,000 to bank 1", async () => {
            // construct JoinSplit proof
            bank1Note1 = await note.create(
              bank1.publicKey,
              100000,
              [regulatorLinkedAccount]
            )
            const sendProof = new JoinSplitProof(
              [distributor1Note1],  // input notes
              [bank1Note1],         // output notes
              distributor.address,       // tx sender
              0, // public token amount
              publicToken.address // public token owner
            )
            const proofData = sendProof.encodeABI(distributorZkAsset.address)
            const proofSignatures = sendProof.constructSignatures(
              distributorZkAsset.address,
              [distributor]
            )
            const tx = await distributorZkAsset["confidentialTransfer(bytes,bytes)"](
              proofData,
              proofSignatures
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(receipt.events).toHaveLength(2)

            const onChainSpentNote = await aceContract.getNote(
              distributorZkAsset.address,
              distributor1Note1.noteHash
            )
            expect(onChainSpentNote.status).toEqual(2) // spent
            expect(onChainSpentNote.noteOwner).toEqual(distributor.address)

            const onChainUnspentNote = await aceContract.getNote(
              distributorZkAsset.address,
              bank1Note1.noteHash
            )
            expect(onChainUnspentNote.status).toEqual(1) // unspent
            expect(onChainUnspentNote.noteOwner).toEqual(bank1.address)

            expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(distributor.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank1.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(0)
            expect(await publicToken.totalSupply()).toEqualBN(0)
        })
        describe.skip("Decrypt output note from the CreateNote event from the confidential transfer transaction", () => {
            let eventArgs
            test("Bank 1 gets the CreateNote event where they are the owner", async () => {
                const filter = bank1ZkAsset.filters.CreateNote(
                  bank1.address,
                  null,
                  null
                )
                const events = await bank1ZkAsset.queryFilter(filter)
                expect(events).toHaveLength(1)
                expect(events[0].event).toEqual("CreateNote")
                eventArgs = events[0].args
                expect(eventArgs.owner).toEqual(bank1.address)
                expect(eventArgs.noteHash).toEqual(bank1Note1.noteHash)
            })
            test("Bank 1 can decrypt output note using private key", async () => {
                const eventNote = await note.fromEventLog(
                  eventArgs.metadata.slice(0, METADATA_AZTEC_DATA_LENGTH + 2),
                  bank1.privateKey
                )
                expect(eventNote.noteHash).toEqual(bank1Note1.noteHash)
                expect(eventNote.k.toNumber()).toEqual(100000)
                expect(eventNote.owner).toEqual(bank1.address)
            })
            test("Regulator can decrypt output note using viewing access key", async () => {
                const metadataObj = metaDataConstructor(eventArgs.metadata.slice(
                  AZTEC_JS_METADATA_PREFIX_LENGTH +
                  AZTEC_JS_DEFAULT_METADATA_PREFIX_LENGTH
                ))
                const allowedAccess = metadataObj.getAccess(regulator.address)
                const encryptedViewingKey = allowedAccess.viewingKey
                const viewingKey = EncryptedViewingKey.fromEncryptedKey(
                  encryptedViewingKey
                )
                const regulatorDecryptedViewingKey = viewingKey.decrypt(regulatorLinkedKeyPair.secretKey)
                expect(regulatorDecryptedViewingKey).toMatch(bytesFixed(69))
                const derivedNote = await note.fromViewKey(
                  regulatorDecryptedViewingKey
                )
                expect(derivedNote.k.toNumber()).toEqual(100000)
            })
            test("Bank 2 can not decrypt output note using private key", async () => {
                expect.assertions(2)
                try {
                    await note.fromEventLog(
                      eventArgs.metadata.slice(0, METADATA_AZTEC_DATA_LENGTH + 2),
                      bank2.privateKey
                    )
                } catch (err) {
                    expect(err).toBeInstanceOf(Error)
                    expect(err.message).toEqual('could not find k!')
                }
            })
        })
        test("Bank 1 confidential transfer of 20,000 to bank 2", async () => {
            bank1Note2 = await note.create(
              bank1.publicKey,
              80000,
              [regulatorLinkedAccount]
            )
            bank2Note1 = await note.create(
              bank2.publicKey,
              20000,
              [regulatorLinkedAccount]
            )
            const sendProof = new JoinSplitProof(
              [bank1Note1],  // input notes
              [bank1Note2, bank2Note1],         // output notes
              bank1.address,       // tx sender
              0, // public token amount
              publicToken.address // public token owner
            )
            const proofData = sendProof.encodeABI(bank1ZkAsset.address)
            const proofSignatures = sendProof.constructSignatures(
              bank1ZkAsset.address,
              [bank1]
            )
            const tx = await bank1ZkAsset["confidentialTransfer(bytes,bytes)"](
              proofData,
              proofSignatures
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(receipt.events).toHaveLength(3)

            const onChainSpentNote = await aceContract.getNote(
              bank1ZkAsset.address,
              bank1Note1.noteHash
            )
            expect(onChainSpentNote.status).toEqual(2) // spent
            expect(onChainSpentNote.noteOwner).toEqual(bank1.address)

            const onChainUnspentNote = await aceContract.getNote(
              bank1ZkAsset.address,
              bank2Note1.noteHash
            )
            expect(onChainUnspentNote.status).toEqual(1) // unspent
            expect(onChainUnspentNote.noteOwner).toEqual(bank2.address)

            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(0)
            expect(await publicToken.totalSupply()).toEqualBN(0)

            expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(distributor.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank1.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank2.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(0)
            expect(await publicToken.totalSupply()).toEqualBN(0)
        })
        describe.skip("Decrypt output notes from the CreateNote events from the confidential transfer transaction", () => {
            let outputNote1EventArgs
            let outputNote2EventArgs
            test("Bank 2 gets all the CreateNote events", async () => {
                const filter = bank2ZkAsset.filters.CreateNote(
                  null,
                  null,
                  null
                )
                const events = await bank2ZkAsset.queryFilter(filter)
                expect(events).toHaveLength(4)
                expect(events[2].event).toEqual("CreateNote")
                expect(events[3].event).toEqual("CreateNote")
                outputNote1EventArgs = events[2].args
                expect(outputNote1EventArgs.owner).toEqual(bank1.address)
                expect(outputNote1EventArgs.noteHash).toEqual(bank1Note2.noteHash)
                outputNote2EventArgs = events[3].args
                expect(outputNote2EventArgs.owner).toEqual(bank2.address)
                expect(outputNote2EventArgs.noteHash).toEqual(bank2Note1.noteHash)
            })
            test("Bank 1 can decrypt first output note using private key", async () => {
                const eventNote = await note.fromEventLog(
                  outputNote1EventArgs.metadata.slice(0, METADATA_AZTEC_DATA_LENGTH + 2),
                  bank1.privateKey
                )
                expect(eventNote.noteHash).toEqual(bank1Note2.noteHash)
                expect(eventNote.k.toNumber()).toEqual(80000)
                expect(eventNote.owner).toEqual(bank1.address)
            })
            test("Bank 2 can decrypt second output note using private key", async () => {
                const eventNote = await note.fromEventLog(
                  outputNote2EventArgs.metadata.slice(0, METADATA_AZTEC_DATA_LENGTH + 2),
                  bank2.privateKey
                )
                expect(eventNote.noteHash).toEqual(bank2Note1.noteHash)
                expect(eventNote.k.toNumber()).toEqual(20000)
                expect(eventNote.owner).toEqual(bank2.address)
            })
            test("Regulator can decrypt first output note using viewing access key", async () => {
                const metadataObj = metaDataConstructor(outputNote1EventArgs.metadata.slice(
                  AZTEC_JS_METADATA_PREFIX_LENGTH +
                  AZTEC_JS_DEFAULT_METADATA_PREFIX_LENGTH
                ))
                const allowedAccess = metadataObj.getAccess(regulator.address)
                const encryptedViewingKey = allowedAccess.viewingKey
                const viewingKey = EncryptedViewingKey.fromEncryptedKey(
                  encryptedViewingKey
                )
                const regulatorDecryptedViewingKey = viewingKey.decrypt(regulatorLinkedKeyPair.secretKey)
                expect(regulatorDecryptedViewingKey).toMatch(bytesFixed(69))
                const derivedNote = await note.fromViewKey(
                  regulatorDecryptedViewingKey
                )
                expect(derivedNote.k.toNumber()).toEqual(80000)
            })
            test("Regulator can decrypt second output note using viewing access key", async () => {
                const metadataObj = metaDataConstructor(outputNote2EventArgs.metadata.slice(
                  AZTEC_JS_METADATA_PREFIX_LENGTH +
                  AZTEC_JS_DEFAULT_METADATA_PREFIX_LENGTH
                ))
                const allowedAccess = metadataObj.getAccess(regulator.address)
                const encryptedViewingKey = allowedAccess.viewingKey
                const viewingKey = EncryptedViewingKey.fromEncryptedKey(
                  encryptedViewingKey
                )
                const regulatorDecryptedViewingKey = viewingKey.decrypt(regulatorLinkedKeyPair.secretKey)
                expect(regulatorDecryptedViewingKey).toMatch(bytesFixed(69))
                const derivedNote = await note.fromViewKey(
                  regulatorDecryptedViewingKey
                )
                expect(derivedNote.k.toNumber()).toEqual(20000)
            })
            test("Bank 1 can not decrypt second output note using private key", async () => {
                expect.assertions(2)
                try {
                    await note.fromEventLog(
                      outputNote2EventArgs.metadata.slice(0, METADATA_AZTEC_DATA_LENGTH + 2),
                      bank1.privateKey
                    )
                } catch (err) {
                    expect(err).toBeInstanceOf(Error)
                    expect(err.message).toEqual('could not find k!')
                }
            })
            test("Bank 2 can not decrypt first output note using private key", async () => {
                expect.assertions(2)
                try {
                    await note.fromEventLog(
                      outputNote1EventArgs.metadata.slice(0, METADATA_AZTEC_DATA_LENGTH + 2),
                      bank2.privateKey
                    )
                } catch (err) {
                    expect(err).toBeInstanceOf(Error)
                    expect(err.message).toEqual('could not find k!')
                }
            })
        })
        test("Bank 1 public withdraws 30,000 to retail user 1", async () => {
            const bank1Note3 = await note.create(
              bank1.publicKey,
              50000
            )
            const withdrawProof = new JoinSplitProof(
              [bank1Note2],  // input notes  - 80000
              [bank1Note3],  // output notes - 50000
              bank1.address, // tx sender
              30000,         // public token withdraw amount (positive)
              user1.address  // public token owner
            )
            const proofData = withdrawProof.encodeABI(bank1ZkAsset.address)
            const proofSignatures = withdrawProof.constructSignatures(
              bank1ZkAsset.address,
              [bank1]
            )
            const tx = await bank1ZkAsset["confidentialTransfer(bytes,bytes)"](proofData, proofSignatures)
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(receipt.events).toHaveLength(8)
            expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(distributor.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank1.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank2.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(user1.address)).toEqualBN(30000)
            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(0)
            expect(await publicToken.totalSupply()).toEqualBN(30000)

            const registry = await aceContract.getRegistry(bank1ZkAsset.address)
            expect(registry.totalSupply).toEqualBN(0)
            expect(registry.totalSupplemented).toEqualBN(30000)
        })
        test("User 1 public transfers 5,000 to user 2", async () => {
            const tx = await user1PublicToken.transfer(user2.address, 5000)
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(distributor.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank1.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank2.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(user1.address)).toEqualBN(25000)
            expect(await publicToken.balanceOf(user2.address)).toEqualBN(5000)
            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(0)
            expect(await publicToken.totalSupply()).toEqualBN(30000)
        })
        describe("User 2 deposits 3000 to Bank 2",() => {
            let depositProof
            let proofData
            test("User 2 approves ACE to transfer from their account", async () => {
                const tx = await user2PublicToken.approve(aceContract.address, 100000)
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
            })
            test("Create deposit proof", async () => {
                bank2Note2 = await note.create(
                  bank2.publicKey,
                  3000
                )
                depositProof = new JoinSplitProof(
                  [],  // input notes
                  [bank2Note2],         // output notes
                  user2.address,       // tx sender
                  -3000, // public token deposit amount (negative)
                  user2.address // public token owner
                )
                proofData = depositProof.encodeABI(user2ZkAsset.address)
            })
            test("User 2 approves the deposit proof with the ACE", async () => {
                const user2AceContract = await aceContract.connect(user2Signer)
                const tx = await user2AceContract.publicApprove(
                  user2ZkAsset.address,
                  depositProof.hash,
                  3000
                )
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
            })
            test("User 2 public deposits 3,000 to bank 2", async () => {
                const tx = await user2ZkAsset["confidentialTransfer(bytes,bytes)"](proofData, [])
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
                expect(receipt.events).toHaveLength(4)

                const onChainUnspentNote = await aceContract.getNote(
                  user2ZkAsset.address,
                  bank2Note2.noteHash
                )
                expect(onChainUnspentNote.status).toEqual(1) // unspent
                expect(onChainUnspentNote.noteOwner).toEqual(bank2.address)

                const registry = await aceContract.getRegistry(user2ZkAsset.address)
                expect(registry.totalSupply).toEqualBN(3000)
                expect(registry.totalSupplemented).toEqualBN(30000)

                expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
                expect(await publicToken.balanceOf(distributor.address)).toEqualBN(0)
                expect(await publicToken.balanceOf(bank1.address)).toEqualBN(0)
                expect(await publicToken.balanceOf(bank2.address)).toEqualBN(0)
                expect(await publicToken.balanceOf(user1.address)).toEqualBN(25000)
                expect(await publicToken.balanceOf(user2.address)).toEqualBN(2000)
                expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(3000)
                expect(await publicToken.totalSupply()).toEqualBN(30000)
            })
        })
        test("Bank 2 confidential transfer 23,000 to distributor", async () => {
            distributor1Note2 = await note.create(
              distributor.publicKey,
              23000
            )
            const sendProof = new JoinSplitProof(
              [bank2Note1, bank2Note2],  // input notes: 20,000 + 3,000
              [distributor1Note2],         // output notes: 23,000
              bank2.address,       // tx sender
              0, // public token amount
              publicToken.address // public token owner
            )
            const proofData = sendProof.encodeABI(bank2ZkAsset.address)
            const proofSignatures = sendProof.constructSignatures(
              bank2ZkAsset.address,
              [bank2, bank2]
            )
            const tx = await bank2ZkAsset["confidentialTransfer(bytes,bytes)"](
              proofData,
              proofSignatures
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(receipt.events).toHaveLength(3)

            const onChainSpentNote = await aceContract.getNote(
              bank2ZkAsset.address,
              bank2Note1.noteHash
            )
            expect(onChainSpentNote.status).toEqual(2) // spent
            expect(onChainSpentNote.noteOwner).toEqual(bank2.address)

            const onChainUnspentNote = await aceContract.getNote(
              distributorZkAsset.address,
              distributor1Note2.noteHash
            )
            expect(onChainUnspentNote.status).toEqual(1) // unspent
            expect(onChainUnspentNote.noteOwner).toEqual(distributor.address)

            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(3000)
            expect(await publicToken.totalSupply()).toEqualBN(30000)

            expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(distributor.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank1.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank2.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(user1.address)).toEqualBN(25000)
            expect(await publicToken.balanceOf(user2.address)).toEqualBN(2000)
            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(3000)
            expect(await publicToken.totalSupply()).toEqualBN(30000)
        })
        test("Distributor confidential transfer 23,000 to Issuer", async () => {
            issuerNote1 = await note.create(
              issuer.publicKey,
              23000
            )
            const sendProof = new JoinSplitProof(
              [distributor1Note2],  // input notes
              [issuerNote1],         // output notes
              distributor.address,       // tx sender
              0, // public token amount
              publicToken.address // public token owner
            )
            const proofData = sendProof.encodeABI(distributorZkAsset.address)
            const proofSignatures = sendProof.constructSignatures(
              distributorZkAsset.address,
              [distributor]
            )
            const tx = await distributorZkAsset["confidentialTransfer(bytes,bytes)"](
              proofData,
              proofSignatures
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(receipt.events).toHaveLength(2)

            const onChainSpentNote = await aceContract.getNote(
              distributorZkAsset.address,
              distributor1Note2.noteHash
            )
            expect(onChainSpentNote.status).toEqual(2) // spent
            expect(onChainSpentNote.noteOwner).toEqual(distributor.address)

            const onChainUnspentNote = await aceContract.getNote(
              distributorZkAsset.address,
              issuerNote1.noteHash
            )
            expect(onChainUnspentNote.status).toEqual(1) // unspent
            expect(onChainUnspentNote.noteOwner).toEqual(issuer.address)

            expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(distributor.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank1.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank2.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(user1.address)).toEqualBN(25000)
            expect(await publicToken.balanceOf(user2.address)).toEqualBN(2000)
            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(3000)
            expect(await publicToken.totalSupply()).toEqualBN(30000)
        })
        test("Issuer confidential burn 23,000", async () => {
            const currentTotalValueNote = await note.createZeroValueNote()
            const newTotalValueNote = await note.create(
              issuer.publicKey,
              23000
            )
            const burnProof = new BurnProof(
              currentTotalValueNote,
              newTotalValueNote,
              [issuerNote1],
              issuer.address
            )
            const burnData = burnProof.encodeABI()
            const tx = await issuerZkAsset.confidentialBurn(
              proofs.BURN_PROOF,
              burnData
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(receipt.events).toHaveLength(2)

            // Check the burnt note is spent
            const onChainNote = await aceContract.getNote(
              issuerZkAsset.address,
              issuerNote1.noteHash
            )
            expect(onChainNote.status).toEqual(2)   // spent

            const registry = await aceContract.getRegistry(user2ZkAsset.address)
            expect(registry.totalSupply).toEqualBN(3000)
            expect(registry.totalSupplemented).toEqualBN(30000)

            expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(distributor.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank1.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank2.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(user1.address)).toEqualBN(25000)
            expect(await publicToken.balanceOf(user2.address)).toEqualBN(2000)
            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(3000)
            expect(await publicToken.totalSupply()).toEqualBN(30000)
        })
    })
    describe("Masked receivers", () => {
        let outputNotes
        test("Issuer confidential mint 200,000 to distributor", async () => {
            const outputNotePromises = [issuer, distributor, bank1, bank2, user1, user2].map((account) => {
                if (account.address === distributor.address) {
                    return note.create(
                      distributor.publicKey,
                      200000,
                      [regulatorLinkedAccount]
                    )
                }
                return note.create(
                  account.publicKey,
                  0,
                  [regulatorLinkedAccount]
                )
            })
            outputNotes = await Promise.all(outputNotePromises)
            const netMintCounterNote = await note.create(issuer.publicKey, 100000 + 200000)

            const mintProof = new MintProof(
              lastMintCounterNote,  // previous sum of all notes
              netMintCounterNote,   // new sum of all notes
              outputNotes,          // new minted notes
              issuer.address        // sender
            )
            const mintData = mintProof.encodeABI()
            const tx = await issuerZkAsset.confidentialMint(
              proofs.MINT_PROOF,
              mintData
            )
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            lastMintCounterNote = netMintCounterNote

            expect(receipt.events).toHaveLength(7)
            expect(receipt.events[0].event).toEqual("CreateNote")
            expect(receipt.events[1].event).toEqual("CreateNote")
            expect(receipt.events[2].event).toEqual("CreateNote")
            expect(receipt.events[3].event).toEqual("CreateNote")
            expect(receipt.events[4].event).toEqual("CreateNote")
            expect(receipt.events[5].event).toEqual("CreateNote")
            expect(receipt.events[6].event).toEqual(
              "UpdateTotalMinted"
            )
            expect(receipt.events[1].args.owner).toEqual(
              distributor.address
            )
            expect(receipt.events[1].args.noteHash).toEqual(
              outputNotes[1].noteHash
            )
            const onChainNote = await aceContract.getNote(
              issuerZkAsset.address,
              outputNotes[1].noteHash
            )
            expect(onChainNote.status).toEqual(1) // unspent
            expect(onChainNote.noteOwner).toEqual(distributor.address)

            // check the registry balances
            const registry = await aceContract.getRegistry(distributorZkAsset.address)
            expect(registry.totalSupply).toEqualBN(3000)
            expect(registry.totalSupplemented).toEqualBN(30000)

            expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(distributor.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank1.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank2.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(user1.address)).toEqualBN(25000)
            expect(await publicToken.balanceOf(user2.address)).toEqualBN(2000)
            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(3000)
            expect(await publicToken.totalSupply()).toEqualBN(30000)
        })
        describe("Decrypt the output note from the CreateNote event from the confidential mint transaction", () => {
            let distributorCreateNoteEventArgs
            let bank1CreateNoteEventArgs
            test("Distributor gets the CreateNote event", async () => {
                const filter = distributorZkAsset.filters.CreateNote(
                  distributor.address,
                  null,
                  null
                )
                const events = await distributorZkAsset.queryFilter(filter)
                expect(events).toHaveLength(3)
                expect(events[2].event).toEqual("CreateNote")
                distributorCreateNoteEventArgs = events[2].args
                expect(distributorCreateNoteEventArgs.owner).toEqual(distributor.address)
                expect(distributorCreateNoteEventArgs.noteHash).toEqual(outputNotes[1].noteHash)
            })
            test("Distributor can decrypt output note", async () => {
                const eventNote = await note.fromEventLog(
                  distributorCreateNoteEventArgs.metadata.slice(0, METADATA_AZTEC_DATA_LENGTH + 2),
                  distributor.privateKey
                )
                expect(eventNote.noteHash).toEqual(outputNotes[1].noteHash)
                expect(eventNote.k.toNumber()).toEqual(200000)
                expect(eventNote.owner).toEqual(distributor.address)
            })
            test("Regulator can decrypt output note using viewing key in metadata from CreateNote event", async () => {
                const metadataObj = metaDataConstructor(distributorCreateNoteEventArgs.metadata.slice(
                  AZTEC_JS_METADATA_PREFIX_LENGTH +
                  AZTEC_JS_DEFAULT_METADATA_PREFIX_LENGTH
                ))
                const allowedAccess = metadataObj.getAccess(regulator.address)
                const encryptedViewingKey = allowedAccess.viewingKey
                const viewingKey = EncryptedViewingKey.fromEncryptedKey(
                  encryptedViewingKey
                )
                const regulatorDecryptedViewingKey = viewingKey.decrypt(regulatorLinkedKeyPair.secretKey)
                expect(regulatorDecryptedViewingKey).toMatch(bytesFixed(69))
                const derivedNote = await note.fromViewKey(
                  regulatorDecryptedViewingKey
                )
                expect(derivedNote.k.toNumber()).toEqual(200000)
            })
            test("Bank 1 can not decrypt the distributor's output note using private key", async () => {
                expect.assertions(2)
                try {
                    await note.fromEventLog(
                      distributorCreateNoteEventArgs.metadata.slice(0, METADATA_AZTEC_DATA_LENGTH + 2),
                      bank1.privateKey
                    )
                } catch (err) {
                    expect(err).toBeInstanceOf(Error)
                    expect(err.message).toEqual('could not find k!')
                }
            })
            test("Bank 1 gets the CreateNote event", async () => {
                const filter = distributorZkAsset.filters.CreateNote(
                  bank1.address,
                  null,
                  null
                )
                const events = await bank1ZkAsset.queryFilter(filter)
                expect(events).toHaveLength(4)
                expect(events[2].event).toEqual("CreateNote")
                bank1CreateNoteEventArgs = events[3].args
                expect(bank1CreateNoteEventArgs.owner).toEqual(bank1.address)
                expect(bank1CreateNoteEventArgs.noteHash).toEqual(outputNotes[2].noteHash)
            })
            test("Bank 1 can decrypt their zero value output note using private key", async () => {
                const eventNote = await note.fromEventLog(
                  bank1CreateNoteEventArgs.metadata.slice(0, METADATA_AZTEC_DATA_LENGTH + 2),
                  bank1.privateKey
                )
                expect(eventNote.noteHash).toEqual(outputNotes[2].noteHash)
                expect(eventNote.owner).toEqual(bank1.address)
                expect(eventNote.k.toNumber()).toEqual(0)
            })
            test("parse bank 1 output note using viewing key", async () => {
                const parsedNote = await note.fromViewKey(outputNotes[2].getView())
                expect(parsedNote.noteHash).toEqual(outputNotes[2].noteHash)
                expect(parsedNote.k.toNumber()).toEqual(0)
            })
        })
    })
})
