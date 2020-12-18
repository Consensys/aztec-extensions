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
    describe("Masked receivers", () => {
        let outputNotes
        let oldOutputNotes
        let bank1Note2
        let bank2Note1
        let bank2Note2
        test("Issuer confidential mint 200,000 to distributor", async () => {
            const lastMintCounterNote = await note.createZeroValueNote()
            const outputNotePromises = [issuer, distributor, bank1, bank2, user1, user2].map((account) => {
                const value = account.address === distributor.address ? 200000 : 0
                return note.create(
                  account.publicKey,
                  value,
                  [regulatorLinkedAccount]
                )
            })
            outputNotes = await Promise.all(outputNotePromises)
            const netMintCounterNote = await note.create(issuer.publicKey, 200000)

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
            expect(registry.totalSupply).toEqualBN(0)
            expect(registry.totalSupplemented).toEqualBN(0)

            expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(distributor.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank1.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank2.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(user1.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(user2.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(0)
            expect(await publicToken.totalSupply()).toEqualBN(0)
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
                expect(events).toHaveLength(1)
                expect(events[0].event).toEqual("CreateNote")
                distributorCreateNoteEventArgs = events[0].args
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
                expect(events).toHaveLength(1)
                expect(events[0].event).toEqual("CreateNote")
                bank1CreateNoteEventArgs = events[0].args
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
        test("Distributor confidential transfer 200,000 to bank 1", async () => {
            oldOutputNotes = outputNotes
            const outputNotePromises = [issuer, distributor, bank1, bank2, user1, user2].map((account) => {
                const value = account.address === bank1.address ? 200000 : 0
                return note.create(
                  account.publicKey,
                  value,
                  [regulatorLinkedAccount]
                )
            })
            outputNotes = await Promise.all(outputNotePromises)
            const sendProof = new JoinSplitProof(
              [oldOutputNotes[1]],  // input notes
              outputNotes,         // output notes
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
            expect(receipt.events).toHaveLength(7)

            const onChainSpentNote = await aceContract.getNote(
              distributorZkAsset.address,
              oldOutputNotes[1].noteHash
            )
            expect(onChainSpentNote.status).toEqual(2) // spent
            expect(onChainSpentNote.noteOwner).toEqual(distributor.address)

            const onChainUnspentNote = await aceContract.getNote(
              distributorZkAsset.address,
              outputNotes[2].noteHash
            )
            expect(onChainUnspentNote.status).toEqual(1) // unspent
            expect(onChainUnspentNote.noteOwner).toEqual(bank1.address)

            // check the registry balances
            const registry = await aceContract.getRegistry(distributorZkAsset.address)
            expect(registry.totalSupply).toEqualBN(0)
            expect(registry.totalSupplemented).toEqualBN(0)

            expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(distributor.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank1.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank2.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(user1.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(user2.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(0)
            expect(await publicToken.totalSupply()).toEqualBN(0)
        })
        describe("Decrypt output note from the CreateNote event from the confidential transfer transaction", () => {
            let eventArgs
            test("Bank 1 gets the CreateNote event using the note hash", async () => {
                const filter = bank1ZkAsset.filters.CreateNote(
                  null,
                  outputNotes[2].noteHash,
                  null
                )
                const events = await bank1ZkAsset.queryFilter(filter)
                expect(events).toHaveLength(1)
                expect(events[0].event).toEqual("CreateNote")
                eventArgs = events[0].args
                expect(eventArgs.owner).toEqual(bank1.address)
                expect(eventArgs.noteHash).toEqual(outputNotes[2].noteHash)
            })
            test("Bank 1 can decrypt output note using private key", async () => {
                const eventNote = await note.fromEventLog(
                  eventArgs.metadata.slice(0, METADATA_AZTEC_DATA_LENGTH + 2),
                  bank1.privateKey
                )
                expect(eventNote.noteHash).toEqual(outputNotes[2].noteHash)
                expect(eventNote.k.toNumber()).toEqual(200000)
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
                expect(derivedNote.k.toNumber()).toEqual(200000)
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
        test("Bank 1 confidential transfer of 40,000 to bank 2", async () => {
            oldOutputNotes = outputNotes
            const outputNotePromises = [issuer, distributor, bank1, bank2, user1, user2].map((account) => {
                let value = 0
                if (account.address === bank1.address) {
                    value = 160000
                } else if (account.address === bank2.address) {
                    value = 40000
                }
                return note.create(
                  account.publicKey,
                  value,
                  [regulatorLinkedAccount]
                )
            })
            outputNotes = await Promise.all(outputNotePromises)
            bank1Note2 = outputNotes[2]
            bank2Note1 = outputNotes[3]
            const sendProof = new JoinSplitProof(
              [oldOutputNotes[2]],  // input notes
              outputNotes,         // output notes
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
            expect(receipt.events).toHaveLength(7)

            const onChainSpentNote = await aceContract.getNote(
              bank1ZkAsset.address,
              oldOutputNotes[2].noteHash
            )
            expect(onChainSpentNote.status).toEqual(2) // spent
            expect(onChainSpentNote.noteOwner).toEqual(bank1.address)

            const onChainUnspentNote = await aceContract.getNote(
              bank1ZkAsset.address,
              outputNotes[3].noteHash
            )
            expect(onChainUnspentNote.status).toEqual(1) // unspent
            expect(onChainUnspentNote.noteOwner).toEqual(bank2.address)

            // check the registry balances
            const registry = await aceContract.getRegistry(distributorZkAsset.address)
            expect(registry.totalSupply).toEqualBN(0)
            expect(registry.totalSupplemented).toEqualBN(0)

            expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(distributor.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank1.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank2.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(user1.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(user2.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(0)
            expect(await publicToken.totalSupply()).toEqualBN(0)
        })
        test("Bank 1 public withdraws 60,000 to retail user 1", async () => {
            oldOutputNotes = outputNotes
            const outputNotePromises = [issuer, distributor, bank1, bank2, user1, user2].map((account) => {
                let value = 0
                if (account.address === bank1.address) {
                    value = 100000
                }
                return note.create(
                  account.publicKey,
                  value,
                  [regulatorLinkedAccount]
                )
            })
            outputNotes = await Promise.all(outputNotePromises)
            const withdrawProof = new JoinSplitProof(
              [bank1Note2],  // input notes  - 160000
              outputNotes,  // output notes - 100000
              bank1.address, // tx sender
              60000,         // public token withdraw amount (positive)
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
            expect(receipt.events).toHaveLength(13)

            // check the registry balances
            const registry = await aceContract.getRegistry(bank1ZkAsset.address)
            expect(registry.totalSupply).toEqualBN(0)
            expect(registry.totalSupplemented).toEqualBN(60000)

            expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(distributor.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank1.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank2.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(user1.address)).toEqualBN(60000) // 0 + 60000
            expect(await publicToken.balanceOf(user2.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(0)
            expect(await publicToken.totalSupply()).toEqualBN(60000)    // 0 + 60000
        })
        test("User 1 public transfers 10,000 to user 2", async () => {
            const tx = await user1PublicToken.transfer(user2.address, 10000)
            expect(tx.hash).toMatch(transactionHash)
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)

            // check the registry balances
            const registry = await aceContract.getRegistry(issuerZkAsset.address)
            expect(registry.totalSupply).toEqualBN(0)
            expect(registry.totalSupplemented).toEqualBN(60000)

            expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(distributor.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank1.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank2.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(user1.address)).toEqualBN(50000) // 60000 - 10000
            expect(await publicToken.balanceOf(user2.address)).toEqualBN(10000) // 0 + 10000
            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(0)
            expect(await publicToken.totalSupply()).toEqualBN(60000)
        })
        describe("User 2 deposits 6000 to Bank 2",() => {
            let depositProof
            let proofData
            test("User 2 approves ACE to transfer from their account", async () => {
                const tx = await user2PublicToken.approve(aceContract.address, 6000)
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
            })
            test("Create deposit proof", async () => {
                oldOutputNotes = outputNotes
                const outputNotePromises = [issuer, distributor, bank1, bank2, user1, user2].map((account) => {
                    let value = 0
                    if (account.address === bank2.address) {
                        value = 6000
                    }
                    return note.create(
                      account.publicKey,
                      value,
                      [regulatorLinkedAccount]
                    )
                })
                outputNotes = await Promise.all(outputNotePromises)
                bank2Note2 = outputNotes[3]
                depositProof = new JoinSplitProof(
                  [],  // input notes
                  outputNotes,         // output notes
                  user2.address,       // tx sender
                  -6000, // public token deposit amount (negative)
                  user2.address // public token owner
                )
                proofData = depositProof.encodeABI(user2ZkAsset.address)
            })
            test("User 2 approves the deposit proof with the ACE", async () => {
                const user2AceContract = await aceContract.connect(user2Signer)
                const tx = await user2AceContract.publicApprove(
                  user2ZkAsset.address,
                  depositProof.hash,
                  6000
                )
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
            })
            test("User 2 public deposits 6,000 to bank 2", async () => {
                const tx = await user2ZkAsset["confidentialTransfer(bytes,bytes)"](proofData, [])
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
                expect(receipt.events).toHaveLength(9)

                const onChainUnspentNote = await aceContract.getNote(
                  user2ZkAsset.address,
                  outputNotes[3].noteHash
                )
                expect(onChainUnspentNote.status).toEqual(1) // unspent
                expect(onChainUnspentNote.noteOwner).toEqual(bank2.address)

                // check the registry balances
                const registry = await aceContract.getRegistry(issuerZkAsset.address)
                expect(registry.totalSupply).toEqualBN(6000)
                expect(registry.totalSupplemented).toEqualBN(60000)

                expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
                expect(await publicToken.balanceOf(distributor.address)).toEqualBN(0)
                expect(await publicToken.balanceOf(bank1.address)).toEqualBN(0)
                expect(await publicToken.balanceOf(bank2.address)).toEqualBN(0)
                expect(await publicToken.balanceOf(user1.address)).toEqualBN(50000)
                expect(await publicToken.balanceOf(user2.address)).toEqualBN(4000)
                expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(6000)
                expect(await publicToken.totalSupply()).toEqualBN(60000)
            })
        })
        test("Bank 2 confidential transfer 46,000 to distributor", async () => {
            oldOutputNotes = outputNotes
            const outputNotePromises = [issuer, distributor, bank1, bank2, user1, user2].map((account) => {
                let value = 0
                if (account.address === distributor.address) {
                    value = 46000
                }
                return note.create(
                  account.publicKey,
                  value,
                  [regulatorLinkedAccount]
                )
            })
            outputNotes = await Promise.all(outputNotePromises)
            expect(bank2Note1.k.toNumber()).toEqual(40000)
            expect(bank2Note2.k.toNumber()).toEqual(6000)
            const sendProof = new JoinSplitProof(
              [bank2Note1, bank2Note2],  // input notes: 40,000 + 6,000
              outputNotes,         // output notes: 46,000
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
            expect(receipt.events).toHaveLength(8)

            const onChainSpentNote = await aceContract.getNote(
              bank2ZkAsset.address,
              bank2Note1.noteHash
            )
            expect(onChainSpentNote.status).toEqual(2) // spent
            expect(onChainSpentNote.noteOwner).toEqual(bank2.address)

            const onChainUnspentNote = await aceContract.getNote(
              distributorZkAsset.address,
              outputNotes[1].noteHash
            )
            expect(onChainUnspentNote.status).toEqual(1) // unspent
            expect(onChainUnspentNote.noteOwner).toEqual(distributor.address)

            // check the registry balances
            const registry = await aceContract.getRegistry(issuerZkAsset.address)
            expect(registry.totalSupply).toEqualBN(6000)
            expect(registry.totalSupplemented).toEqualBN(60000)

            expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(distributor.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank1.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank2.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(user1.address)).toEqualBN(50000)
            expect(await publicToken.balanceOf(user2.address)).toEqualBN(4000)
            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(6000)
            expect(await publicToken.totalSupply()).toEqualBN(60000)
        })
        test("Distributor confidential transfer 46,000 to Issuer", async () => {
            oldOutputNotes = outputNotes
            const outputNotePromises = [issuer, distributor, bank1, bank2, user1, user2].map((account) => {
                let value = 0
                if (account.address === issuer.address) {
                    value = 46000
                }
                return note.create(
                  account.publicKey,
                  value,
                  [regulatorLinkedAccount]
                )
            })
            outputNotes = await Promise.all(outputNotePromises)
            const sendProof = new JoinSplitProof(
              [oldOutputNotes[1]],  // input notes
              outputNotes,         // output notes
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
            expect(receipt.events).toHaveLength(7)

            const onChainSpentNote = await aceContract.getNote(
              distributorZkAsset.address,
              oldOutputNotes[1].noteHash
            )
            expect(onChainSpentNote.status).toEqual(2) // spent
            expect(onChainSpentNote.noteOwner).toEqual(distributor.address)

            const onChainUnspentNote = await aceContract.getNote(
              distributorZkAsset.address,
              outputNotes[0].noteHash
            )
            expect(onChainUnspentNote.status).toEqual(1) // unspent
            expect(onChainUnspentNote.noteOwner).toEqual(issuer.address)

            // check the registry balances
            const registry = await aceContract.getRegistry(issuerZkAsset.address)
            expect(registry.totalSupply).toEqualBN(6000)
            expect(registry.totalSupplemented).toEqualBN(60000)

            expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(distributor.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank1.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank2.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(user1.address)).toEqualBN(50000)
            expect(await publicToken.balanceOf(user2.address)).toEqualBN(4000)
            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(6000)
            expect(await publicToken.totalSupply()).toEqualBN(60000)
        })
        test("Issuer confidential burn 46,000", async () => {
            const lastBurnCounterNote = await note.createZeroValueNote()
            oldOutputNotes = outputNotes
            const newTotalValueNote = await note.create(
              issuer.publicKey,
              46000
            )
            const burnProof = new BurnProof(
              lastBurnCounterNote,
              newTotalValueNote,
              [oldOutputNotes[0]],
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
              oldOutputNotes[0].noteHash
            )
            expect(onChainNote.status).toEqual(2)   // spent

            // check the registry balances
            const registry = await aceContract.getRegistry(issuerZkAsset.address)
            expect(registry.totalSupply).toEqualBN(6000)
            expect(registry.totalSupplemented).toEqualBN(60000)

            expect(await publicToken.balanceOf(issuer.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(distributor.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank1.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(bank2.address)).toEqualBN(0)
            expect(await publicToken.balanceOf(user1.address)).toEqualBN(50000)
            expect(await publicToken.balanceOf(user2.address)).toEqualBN(4000)
            expect(await publicToken.balanceOf(aceContract.address)).toEqualBN(6000)
            expect(await publicToken.totalSupply()).toEqualBN(60000)
        })
    })
})
