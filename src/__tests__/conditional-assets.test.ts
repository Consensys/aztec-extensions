import { proofs } from "@aztec/dev-utils"
import secp256k1 from "@aztec/secp256k1"
import { JoinSplitProof, MintProof, note } from "aztec.js"
import { ethers, Signer } from "ethers"
import nacl from "tweetnacl"
import { compilerOutput as ZkConditionAggregatedCompilerOutput } from "../chain/contracts/ZkConditionAggregatedContract"
import { compilerOutput as ZkConditionApprovedAccountsCompilerOutput } from "../chain/contracts/ZkConditionApprovedAccountsContract"
import { compilerOutput as ZkConditionSuspendCompilerOutput } from "../chain/contracts/ZkConditionSuspendContract"
import { compilerOutput as ZkConditionViewAccessCompilerOutput } from "../chain/contracts/ZkConditionViewAccessContract"
import AceMigator from "../chain/migration/1_ace"
import ZkAssetConditionalMigrator from "../chain/migration/7_zkAssetConditional"
import migratorFactory, { Migrator } from "../chain/migration/migrator"
import { Ace } from "../chain/types/Ace"
import { ZkAssetConditional } from "../chain/types/ZkAssetConditional"
import { ZkConditionAggregated } from "../chain/types/ZkConditionAggregated"
import { ZkConditionApprovedAccounts } from "../chain/types/ZkConditionApprovedAccounts"
import { ZkConditionSuspend } from "../chain/types/ZkConditionSuspend"
import { ZkConditionViewAccess } from "../chain/types/ZkConditionViewAccess"
import { zeroAddress } from "../chain/utils/addresses"
import { WalletSigner } from "../chain/wallet/WalletSigner"
import configPromise from "../config/index"
import { EthersMatchers } from "../utils/jest"
import { ethereumAddress, transactionHash } from "../utils/regEx"

jest.setTimeout(60000) // timeout for each test in milliseconds
// Extend the Jest matchers with Ethers BigNumber matchers like toEqualBN
expect.extend(EthersMatchers)

// 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf
const deployer = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000001"
)
const issuer = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000002"
)
const bank1 = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000003"
)
const bank2 = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000004"
)
const bank3 = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000005"
)
const regulator = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000006"
)

describe("Conditional transfers of notes", () => {
    let aceContract: Ace
    let account2AceContract: Ace
    let account3AceContract: Ace
    let account5AceContract: Ace
    let migrator: Migrator
    let issuerSigner: Signer
    let bank1Signer: Signer
    let bank2Signer: Signer
    let bank3Signer: Signer
    let regulatorSigner: Signer

    beforeAll(async () => {
        const config = await configPromise
        if (!config?.chain?.wallet) {
            throw Error(`Failed to load config for chain.wallet.`)
        }
        const deployerWallet = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: deployer.privateKey,
        })
        migrator = await migratorFactory(deployerWallet)
        issuerSigner = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: issuer.privateKey,
        })
        bank1Signer = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: bank1.privateKey,
        })
        bank2Signer = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: bank2.privateKey,
        })
        bank3Signer = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: bank3.privateKey,
        })
        regulatorSigner = await WalletSigner.create({
            ...config?.chain?.wallet,
            privateKey: regulator.privateKey,
        })
    })

    test("Deploy proof contracts and ACE", async () => {
        aceContract = await AceMigator(migrator)
        expect(aceContract.address).toMatch(ethereumAddress)
        account2AceContract = aceContract.connect(issuerSigner)
        account3AceContract = aceContract.connect(bank1Signer)
        account5AceContract = aceContract.connect(regulatorSigner)
        expect(await regulatorSigner.getAddress()).toEqual(regulator.address)
    })

    describe("Suspend Condition Contract", () => {
        let suspendConditionContract: ZkConditionSuspend
        test("Deploy Suspend Contract", async () => {
            suspendConditionContract = await migrator.deploy<ZkConditionSuspend>(
                ZkConditionSuspendCompilerOutput,
                false
            )
            expect(suspendConditionContract.address).toMatch(ethereumAddress)
            expect(suspendConditionContract.deployed()).toBeTruthy()
        })

        test("Can transfer when not suspended", async () => {
            const tx = await suspendConditionContract.canTransfer(
                proofs.JOIN_SPLIT_PROOF,
                "0x",
                issuer.address,
                0,
                issuer.address
            )
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
        })

        test("Can not suspend if not the owner", async () => {
            expect.assertions(2)
            const bank1SuspendConditionContract = suspendConditionContract.connect(
                bank1Signer
            )
            try {
                const tx = await bank1SuspendConditionContract.suspend()
                await tx.wait()
            } catch (err) {
                expect(err).toBeInstanceOf(Error)
                expect(err.message).toMatch("caller is not the owner")
            }
        })

        test("Can not resume if not the suspended", async () => {
            expect.assertions(2)
            try {
                const tx = await suspendConditionContract.resume()
                await tx.wait()
            } catch (err) {
                expect(err).toBeInstanceOf(Error)
                expect(err.message).toMatch("Already resumed")
            }
        })

        test("Owner of contract suspends transfers", async () => {
            const tx = await suspendConditionContract.suspend()
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(receipt.events).toHaveLength(1)
            expect(receipt.events[0].event).toEqual("Suspend")
            expect(receipt.events[0].args).toHaveLength(1)
            expect(receipt.events[0].args.owner).toEqual(deployer.address)
        })

        test("Can not transfer when suspended", async () => {
            expect.assertions(2)
            try {
                const tx = await suspendConditionContract.canTransfer(
                    proofs.JOIN_SPLIT_PROOF,
                    "0x",
                    issuer.address,
                    0,
                    issuer.address
                )
                await tx.wait()
            } catch (err) {
                expect(err).toBeInstanceOf(Error)
                expect(err.message).toMatch("all transfers are suspended")
            }
        })

        test("Can not resume if not the owner", async () => {
            expect.assertions(2)
            const bank1SuspendConditionContract = suspendConditionContract.connect(
                bank1Signer
            )
            try {
                const tx = await bank1SuspendConditionContract.resume()
                await tx.wait()
            } catch (err) {
                expect(err).toBeInstanceOf(Error)
                expect(err.message).toMatch("caller is not the owner")
            }
        })

        test("Can not suspend if already suspended", async () => {
            expect.assertions(2)
            try {
                const tx = await suspendConditionContract.suspend()
                await tx.wait()
            } catch (err) {
                expect(err).toBeInstanceOf(Error)
                expect(err.message).toMatch("Already suspended")
            }
        })

        test("Owner of contract resumes transfers", async () => {
            const tx = await suspendConditionContract.resume()
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
            expect(receipt.events).toHaveLength(1)
            expect(receipt.events[0].event).toEqual("Resume")
            expect(receipt.events[0].args).toHaveLength(1)
            expect(receipt.events[0].args.owner).toEqual(deployer.address)
        })

        test("Can transfer after resume", async () => {
            const tx = await suspendConditionContract.canTransfer(
                proofs.JOIN_SPLIT_PROOF,
                "0x",
                bank1.address,
                100000,
                bank1.address
            )
            const receipt = await tx.wait()
            expect(receipt.status).toEqual(1)
        })
    })

    describe("Approved accounts condition contract", () => {
        let approvedAccountsConditionContract: ZkConditionApprovedAccounts
        test("Deploy approved account contract", async () => {
            approvedAccountsConditionContract = await migrator.deploy<ZkConditionApprovedAccounts>(
                ZkConditionApprovedAccountsCompilerOutput,
                [bank1.address, bank2.address]
            )
            expect(approvedAccountsConditionContract.address).toMatch(
                ethereumAddress
            )
            expect(approvedAccountsConditionContract.deployed()).toBeTruthy()
        })
        test("Bank 3 can not approve a new customer", async () => {
            expect.assertions(2)
            const bank3ApprovedAccountsConditionContract = approvedAccountsConditionContract.connect(
                bank3Signer
            )
            const newCustomer = secp256k1.generateAccount()
            try {
                const tx = await bank3ApprovedAccountsConditionContract.approve(
                    newCustomer.address
                )
                await tx.wait()
            } catch (err) {
                expect(err).toBeInstanceOf(Error)
                expect(err.message).toMatch("not an approver")
            }
        })
        describe("Bank 1 can approve a customer who can then transfer", () => {
            const bank1Customer1 = secp256k1.generateAccount()
            let bank1ApprovedAccountsConditionContract
            let bank2ApprovedAccountsConditionContract
            test("New customer can receive a note before being approved", async () => {
                expect.assertions(2)
                try {
                    const tx = await approvedAccountsConditionContract.canReceiveNote(
                        bank1Customer1.address,
                        ethers.utils.arrayify(ethers.utils.randomBytes(32)),
                        "0x",
                        bank1.address
                    )
                    await tx.wait()
                } catch (err) {
                    expect(err).toBeInstanceOf(Error)
                    expect(err.message).toMatch(
                        "Account not approved to receive notes"
                    )
                }
            })
            test("Bank 1 approves new customer", async () => {
                bank1ApprovedAccountsConditionContract = approvedAccountsConditionContract.connect(
                    bank1Signer
                )
                const tx = await bank1ApprovedAccountsConditionContract.approve(
                    bank1Customer1.address
                )
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
                expect(receipt.events).toHaveLength(1)
                expect(receipt.events[0].event).toEqual("ApprovedAccount")
                expect(receipt.events[0].args).toHaveLength(2)
                expect(receipt.events[0].args.account).toEqual(
                    bank1Customer1.address
                )
                expect(receipt.events[0].args.sender).toEqual(bank1.address)
            })
            test("New customer can receive a note", async () => {
                const tx = await approvedAccountsConditionContract.canReceiveNote(
                    bank1Customer1.address,
                    ethers.utils.arrayify(ethers.utils.randomBytes(32)),
                    "0x",
                    bank1.address
                )
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
            })
            test("Bank 2 rejects Bank 1's new customer", async () => {
                bank2ApprovedAccountsConditionContract = approvedAccountsConditionContract.connect(
                    bank2Signer
                )
                const tx = await bank1ApprovedAccountsConditionContract.reject(
                    bank1Customer1.address
                )
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
                expect(receipt.events).toHaveLength(1)
                expect(receipt.events[0].event).toEqual("RejectedAccount")
                expect(receipt.events[0].args).toHaveLength(2)
                expect(receipt.events[0].args.account).toEqual(
                    bank1Customer1.address
                )
                expect(receipt.events[0].args.sender).toEqual(bank1.address)
            })
            test("New customer can no longer receive a note", async () => {
                expect.assertions(2)
                try {
                    const tx = await approvedAccountsConditionContract.canReceiveNote(
                        bank1Customer1.address,
                        ethers.utils.arrayify(ethers.utils.randomBytes(32)),
                        "0x",
                        bank1.address
                    )
                    await tx.wait()
                } catch (err) {
                    expect(err).toBeInstanceOf(Error)
                    expect(err.message).toMatch(
                        "Account not approved to receive notes"
                    )
                }
            })
        })

        describe("Adding approvers", async () => {
            let bank3ApprovedAccountsConditionContract
            test("Deployer adds Bank 3 as an approver", async () => {
                const tx = await approvedAccountsConditionContract.addApprover(
                    bank3.address
                )
                const receipt = await tx.wait()
                expect(receipt.events).toHaveLength(1)
                expect(receipt.events[0].event).toEqual("AddApprover")
                expect(receipt.events[0].args).toHaveLength(2)
                expect(receipt.events[0].args.approver).toEqual(bank3.address)
                expect(receipt.events[0].args.sender).toEqual(deployer.address)
            })
            test("Bank 3 approves new customer", async () => {
                bank3ApprovedAccountsConditionContract = approvedAccountsConditionContract.connect(
                    bank3Signer
                )
                const newCustomer = secp256k1.generateAccount()
                const tx = await bank3ApprovedAccountsConditionContract.approve(
                    newCustomer.address
                )
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
                expect(receipt.events).toHaveLength(1)
                expect(receipt.events[0].event).toEqual("ApprovedAccount")
                expect(receipt.events[0].args).toHaveLength(2)
                expect(receipt.events[0].args.account).toEqual(
                    newCustomer.address
                )
                expect(receipt.events[0].args.sender).toEqual(bank3.address)
            })
            test("Bank 3 removes Bank 1 as an approver", async () => {
                const tx = await bank3ApprovedAccountsConditionContract.removeApprover(
                    bank1.address
                )
                const receipt = await tx.wait()
                expect(receipt.events).toHaveLength(1)
                expect(receipt.events[0].event).toEqual("RemoveApprover")
                expect(receipt.events[0].args).toHaveLength(2)
                expect(receipt.events[0].args.approver).toEqual(bank1.address)
                expect(receipt.events[0].args.sender).toEqual(bank3.address)
            })
            test("Bank 1 can not approve a new customer", async () => {
                expect.assertions(2)
                const bank1ApprovedAccountsConditionContract = approvedAccountsConditionContract.connect(
                    bank1Signer
                )
                const newCustomer = secp256k1.generateAccount()
                try {
                    const tx = await bank1ApprovedAccountsConditionContract.approve(
                        newCustomer.address
                    )
                    await tx.wait()
                } catch (err) {
                    expect(err).toBeInstanceOf(Error)
                    expect(err.message).toMatch("not an approver")
                }
            })
        })
    })

    describe("View access condition contract", () => {
        let viewAccessConditionContract: ZkConditionViewAccess
        let zkAsset: ZkAssetConditional
        let bank1Asset: ZkAssetConditional
        const regulatorLinkedKeyPair = nacl.box.keyPair()
        const regulatorLinkedAccount = {
            address: regulator.address,
            linkedPublicKey: ethers.utils.hexlify(
                regulatorLinkedKeyPair.publicKey
            ),
        }
        test("Deploy view access contract", async () => {
            viewAccessConditionContract = await migrator.deploy<ZkConditionViewAccess>(
                ZkConditionViewAccessCompilerOutput,
                [regulator.address]
            )
            expect(viewAccessConditionContract.address).toMatch(ethereumAddress)
            expect(viewAccessConditionContract.deployed()).toBeTruthy()
        })
        test("Deploy conditional zero-knowledge asset linked to view access contract", async () => {
            zkAsset = await ZkAssetConditionalMigrator(
                migrator,
                aceContract.address,
                viewAccessConditionContract.address
            )
            bank1Asset = zkAsset.connect(bank1Signer)
        })
        let bank1Note1
        describe("Mint notes", () => {
            test("Asset deployer (owner) can NOT mint a note with no granted view access", async () => {
                expect.assertions(2)
                const bank1Note = await note.create(bank1.publicKey, 100)
                const currentTotalValueNote = await note.createZeroValueNote()
                const mintProof = new MintProof(
                    currentTotalValueNote, // currentTotalValueNote
                    bank1Note, // newTotalValueNote
                    [bank1Note], // mintedNotes
                    deployer.address // sender
                )
                const mintData = mintProof.encodeABI()
                try {
                    const tx = await zkAsset.confidentialMint(
                        proofs.MINT_PROOF,
                        mintData
                    )
                    await tx.wait()
                } catch (err) {
                    expect(err).toBeInstanceOf(Error)
                    expect(err.message).toMatch(
                        "View access has not been granted to one of the required view accounts"
                    )
                }
            })
            test("Asset deployer (owner) can NOT mint a note with regular NOT granted view access", async () => {
                expect.assertions(2)
                const randomKeyPair = nacl.box.keyPair()
                const bank1InvalidNote = await note.create(
                    bank1.publicKey,
                    100,
                    [
                        {
                            address: issuer.address,
                            linkedPublicKey: ethers.utils.hexlify(
                                randomKeyPair.publicKey
                            ),
                        },
                        {
                            address: bank1.address,
                            linkedPublicKey: ethers.utils.hexlify(
                                randomKeyPair.publicKey
                            ),
                        },
                    ]
                )
                const tempTotalValueNote = await note.create(
                    issuer.publicKey,
                    100
                )
                const currentTotalValueNote = await note.createZeroValueNote()
                const mintProof = new MintProof(
                    currentTotalValueNote, // currentTotalValueNote
                    tempTotalValueNote, // newTotalValueNote
                    [bank1InvalidNote], // mintedNotes
                    deployer.address // sender
                )
                const mintData = mintProof.encodeABI()
                try {
                    const tx = await zkAsset.confidentialMint(
                        proofs.MINT_PROOF,
                        mintData
                    )
                    await tx.wait()
                } catch (err) {
                    expect(err).toBeInstanceOf(Error)
                    expect(err.message).toMatch(
                        "View access has not been granted to one of the required view accounts"
                    )
                }
            })
            let newTotalValueNote
            test("Asset deployer (owner) can mint a note with regular granted view access", async () => {
                bank1Note1 = await note.create(bank1.publicKey, 100, [
                    regulatorLinkedAccount,
                ])
                const currentTotalValueNote = await note.createZeroValueNote()
                newTotalValueNote = await note.create(issuer.publicKey, 100, [
                    regulatorLinkedAccount,
                ])
                const mintProof = new MintProof(
                    currentTotalValueNote, // currentTotalValueNote
                    newTotalValueNote, // newTotalValueNote
                    [bank1Note1], // mintedNotes
                    deployer.address // sender
                )
                const mintData = mintProof.encodeABI()
                const tx = await zkAsset.confidentialMint(
                    proofs.MINT_PROOF,
                    mintData
                )
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
                expect(receipt.events).toHaveLength(4)
                expect(receipt.events[2].event).toEqual("ApprovedAddress")
                expect(receipt.events[2].args).toHaveLength(4)
                expect(receipt.events[2].args.grantedAddress).toEqual(
                    regulator.address
                )
                expect(receipt.events[2].args.noteHash).toEqual(
                    newTotalValueNote.noteHash
                )
                expect(receipt.events[3].event).toEqual("ApprovedAddress")
                expect(receipt.events[3].args).toHaveLength(4)
                expect(receipt.events[3].args.grantedAddress).toEqual(
                    regulator.address
                )
                expect(receipt.events[3].args.noteHash).toEqual(
                    bank1Note1.noteHash
                )
            })

            test("Asset deployer (owner) can mint a note with issuer and regular granted view access", async () => {
                const randomKeyPair = nacl.box.keyPair()
                const bank1Note2 = await note.create(bank1.publicKey, 200, [
                    {
                        address: issuer.address,
                        linkedPublicKey: ethers.utils.hexlify(
                            randomKeyPair.publicKey
                        ),
                    },
                    regulatorLinkedAccount,
                ])
                const currentTotalValueNote = newTotalValueNote
                newTotalValueNote = await note.create(issuer.publicKey, 300, [
                    regulatorLinkedAccount,
                ])
                const mintProof = new MintProof(
                    currentTotalValueNote, // currentTotalValueNote
                    newTotalValueNote, // newTotalValueNote
                    [bank1Note2], // mintedNotes
                    deployer.address // sender
                )
                const mintData = mintProof.encodeABI()
                const tx = await zkAsset.confidentialMint(
                    proofs.MINT_PROOF,
                    mintData
                )
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
                expect(receipt.events).toHaveLength(5)
                expect(receipt.events[2].event).toEqual("ApprovedAddress")
                expect(receipt.events[2].args).toHaveLength(4)
                expect(receipt.events[2].args.grantedAddress).toEqual(
                    regulator.address
                )
                expect(receipt.events[2].args.noteHash).toEqual(
                    newTotalValueNote.noteHash
                )
                expect(receipt.events[3].event).toEqual("ApprovedAddress")
                expect(receipt.events[3].args).toHaveLength(4)
                expect(receipt.events[3].args.grantedAddress).toEqual(
                    issuer.address
                )
                expect(receipt.events[4].args.noteHash).toEqual(
                    bank1Note2.noteHash
                )
                expect(receipt.events[4].event).toEqual("ApprovedAddress")
                expect(receipt.events[4].args).toHaveLength(4)
                expect(receipt.events[4].args.grantedAddress).toEqual(
                    regulator.address
                )
                expect(receipt.events[4].args.noteHash).toEqual(
                    bank1Note2.noteHash
                )
            })
        })

        describe("Join Split", () => {
            test("Can transfer to bank 2 with regular granted view access", async () => {
                const bank2Note1 = await note.create(bank2.publicKey, 80, [
                    regulatorLinkedAccount,
                ])
                const bank1Note2 = await note.create(bank2.publicKey, 20, [
                    regulatorLinkedAccount,
                ])
                const sendProof = new JoinSplitProof(
                    [bank1Note1], // input notes
                    [bank1Note2, bank2Note1], // output notes
                    bank1.address, // tx sender
                    0, // deposit (negative), withdrawal (positive) or transfer (zero)
                    zeroAddress // public token owner. Only relevant for deposits or withdrawals
                )
                const proofData = sendProof.encodeABI(zkAsset.address)
                const proofSignatures = sendProof.constructSignatures(
                    zkAsset.address,
                    [bank1]
                )
                const tx = await bank1Asset[
                    "confidentialTransfer(bytes,bytes)"
                ](proofData, proofSignatures)
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
                expect(receipt.events).toHaveLength(5)
                expect(receipt.events[3].event).toEqual("ApprovedAddress")
                expect(receipt.events[3].args).toHaveLength(4)
                expect(receipt.events[3].args.grantedAddress).toEqual(
                    regulator.address
                )
                expect(receipt.events[3].args.noteHash).toEqual(
                    bank1Note2.noteHash
                )
                expect(receipt.events[4].event).toEqual("ApprovedAddress")
                expect(receipt.events[4].args).toHaveLength(4)
                expect(receipt.events[4].args.grantedAddress).toEqual(
                    regulator.address
                )
                expect(receipt.events[4].args.noteHash).toEqual(
                    bank2Note1.noteHash
                )
            })
        })
    })

    describe("Aggregated conditions", () => {
        let suspendConditionContract: ZkConditionSuspend
        let approvedAccountsConditionContract: ZkConditionApprovedAccounts
        let viewAccessConditionContract: ZkConditionViewAccess
        let aggregatedConditionContract: ZkConditionAggregated
        let issuerZkAsset: ZkAssetConditional
        let bank1ZkAsset: ZkAssetConditional
        let newTotalValueNote
        const regulatorLinkedKeyPair = nacl.box.keyPair()
        const regulatorLinkedAccount = {
            address: regulator.address,
            linkedPublicKey: ethers.utils.hexlify(
                regulatorLinkedKeyPair.publicKey
            ),
        }
        const issuerLinkedKeyPair = nacl.box.keyPair()
        const issuerLinkedAccount = {
            address: issuer.address,
            linkedPublicKey: ethers.utils.hexlify(
                issuerLinkedKeyPair.publicKey
            ),
        }
        let issuerMigrator: Migrator
        beforeAll(async () => {
            issuerMigrator = await migratorFactory(issuerSigner)
        })
        describe("Setup", () => {
            test("Deploy suspend condition contract", async () => {
                suspendConditionContract = await migrator.deploy<ZkConditionSuspend>(
                    ZkConditionSuspendCompilerOutput,
                    false
                )
                expect(suspendConditionContract.address).toMatch(
                    ethereumAddress
                )
                expect(suspendConditionContract.deployed()).toBeTruthy()
            })
            test("Deploy approved account condition contract", async () => {
                approvedAccountsConditionContract = await migrator.deploy<ZkConditionApprovedAccounts>(
                    ZkConditionApprovedAccountsCompilerOutput,
                    [
                        issuer.address,
                        bank1.address,
                        bank2.address,
                        bank3.address,
                    ]
                )
                expect(approvedAccountsConditionContract.address).toMatch(
                    ethereumAddress
                )
                expect(
                    approvedAccountsConditionContract.deployed()
                ).toBeTruthy()
            })
            test("Deploy view access condition contract", async () => {
                viewAccessConditionContract = await migrator.deploy<ZkConditionViewAccess>(
                    ZkConditionViewAccessCompilerOutput,
                    [issuer.address, regulator.address]
                )
                expect(viewAccessConditionContract.address).toMatch(
                    ethereumAddress
                )
                expect(viewAccessConditionContract.deployed()).toBeTruthy()
            })
            test("Deploy aggregated condition contract", async () => {
                aggregatedConditionContract = await migrator.deploy<ZkConditionAggregated>(
                    ZkConditionAggregatedCompilerOutput,
                    [
                        suspendConditionContract.address,
                        approvedAccountsConditionContract.address,
                        viewAccessConditionContract.address,
                    ]
                )
                expect(aggregatedConditionContract.address).toMatch(
                    ethereumAddress
                )
                expect(aggregatedConditionContract.deployed()).toBeTruthy()
            })
            test("Issuer deploys conditional zero-knowledge asset linked to suspend condition contract", async () => {
                issuerZkAsset = await ZkAssetConditionalMigrator(
                    issuerMigrator,
                    aceContract.address,
                    aggregatedConditionContract.address
                )
                bank1ZkAsset = issuerZkAsset.connect(issuerSigner)
            })
        })
        describe("Minting", () => {
            test("Issuer mints notes to issuer, bank1 and bank2", async () => {
                const currentTotalValueNote = await note.createZeroValueNote()
                const issuerZeroValueNote = await note.create(
                    issuer.publicKey,
                    0,
                    [issuerLinkedAccount, regulatorLinkedAccount]
                )
                const bank1Note1 = await note.create(bank1.publicKey, 100000, [
                    issuerLinkedAccount,
                    regulatorLinkedAccount,
                ])
                const bank2Note1 = await note.create(bank2.publicKey, 200000, [
                    issuerLinkedAccount,
                    regulatorLinkedAccount,
                ])
                const bank3ZeroValueNote = await note.create(
                    bank3.publicKey,
                    0,
                    [issuerLinkedAccount, regulatorLinkedAccount]
                )
                newTotalValueNote = await note.create(
                    issuer.publicKey,
                    300000,
                    [issuerLinkedAccount, regulatorLinkedAccount]
                )
                const mintProof = new MintProof(
                    currentTotalValueNote, // currentTotalValueNote
                    newTotalValueNote, // newTotalValueNote
                    [
                        issuerZeroValueNote,
                        bank1Note1,
                        bank2Note1,
                        bank3ZeroValueNote,
                    ], // mintedNotes
                    issuer.address // sender
                )
                const mintData = mintProof.encodeABI()
                const tx = await issuerZkAsset.confidentialMint(
                    proofs.MINT_PROOF,
                    mintData
                )
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
                expect(receipt.events).toHaveLength(15)
            })
            test("Issuer mints a zero value note to themselves", async () => {
                const currentTotalValueNote = newTotalValueNote
                const issuerZeroValueNote = await note.create(
                    issuer.publicKey,
                    0,
                    [issuerLinkedAccount, regulatorLinkedAccount]
                )
                newTotalValueNote = await note.create(
                    issuer.publicKey,
                    300000,
                    [issuerLinkedAccount, regulatorLinkedAccount]
                )
                const mintProof = new MintProof(
                    currentTotalValueNote, // currentTotalValueNote
                    newTotalValueNote, // newTotalValueNote
                    [issuerZeroValueNote], // mintedNotes
                    issuer.address // sender
                )
                const mintData = mintProof.encodeABI()
                const tx = await issuerZkAsset.confidentialMint(
                    proofs.MINT_PROOF,
                    mintData
                )
                expect(tx.hash).toMatch(transactionHash)
                const receipt = await tx.wait()
                expect(receipt.status).toEqual(1)
            })
            test("Issuer can NOT mint to bank 1 customer not approved", async () => {
                expect.assertions(2)
                const currentTotalValueNote = newTotalValueNote
                const randomCustomer = secp256k1.generateAccount()
                const testNote = await note.create(
                    randomCustomer.publicKey,
                    0,
                    [issuerLinkedAccount, regulatorLinkedAccount]
                )
                const newFailedTotalValueNote = await note.create(
                    issuer.publicKey,
                    300000,
                    [issuerLinkedAccount, regulatorLinkedAccount]
                )
                const mintProof = new MintProof(
                    currentTotalValueNote, // currentTotalValueNote
                    newFailedTotalValueNote, // newTotalValueNote
                    [testNote], // mintedNotes
                    issuer.address // sender
                )
                const mintData = mintProof.encodeABI()
                try {
                    const tx = await issuerZkAsset.confidentialMint(
                        proofs.MINT_PROOF,
                        mintData
                    )
                    await tx.wait()
                } catch (err) {
                    expect(err).toBeInstanceOf(Error)
                    expect(err.message).toMatch(
                        "Account not approved to receive notes"
                    )
                }
            })
            test("Issuer can NOT mint as note transfers are suspended", async () => {
                expect.assertions(4)
                const tx1 = await suspendConditionContract.suspend()
                const receipt1 = await tx1.wait()
                expect(receipt1.status).toEqual(1)

                const currentTotalValueNote = newTotalValueNote
                const issuerZeroValueNote = await note.create(
                    issuer.publicKey,
                    0,
                    [issuerLinkedAccount, regulatorLinkedAccount]
                )
                const newFailedTotalValueNote = await note.create(
                    issuer.publicKey,
                    300000,
                    [issuerLinkedAccount, regulatorLinkedAccount]
                )
                const mintProof = new MintProof(
                    currentTotalValueNote, // currentTotalValueNote
                    newFailedTotalValueNote, // newTotalValueNote
                    [issuerZeroValueNote], // mintedNotes
                    issuer.address // sender
                )
                const mintData = mintProof.encodeABI()
                try {
                    const tx = await issuerZkAsset.confidentialMint(
                        proofs.MINT_PROOF,
                        mintData
                    )
                    await tx.wait()
                } catch (err) {
                    expect(err).toBeInstanceOf(Error)
                    expect(err.message).toMatch("all transfers are suspended")
                    const tx2 = await suspendConditionContract.resume()
                    const receipt2 = await tx2.wait()
                    expect(receipt2.status).toEqual(1)
                }
            })
            test("Issuer can NOT mint as note does not grant view access to the regulator", async () => {
                expect.assertions(2)
                const currentTotalValueNote = newTotalValueNote
                const issuerZeroValueNote = await note.create(
                    issuer.publicKey,
                    0,
                    [issuerLinkedAccount] // no regulator
                )
                const newFailedTotalValueNote = await note.create(
                    issuer.publicKey,
                    300000,
                    [issuerLinkedAccount, regulatorLinkedAccount]
                )
                const mintProof = new MintProof(
                    currentTotalValueNote, // currentTotalValueNote
                    newFailedTotalValueNote, // newTotalValueNote
                    [issuerZeroValueNote], // mintedNotes
                    issuer.address // sender
                )
                const mintData = mintProof.encodeABI()
                try {
                    const tx = await issuerZkAsset.confidentialMint(
                        proofs.MINT_PROOF,
                        mintData
                    )
                    await tx.wait()
                } catch (err) {
                    expect(err).toBeInstanceOf(Error)
                    expect(err.message).toMatch(
                        "View access has not been granted to one of the required view accounts"
                    )
                }
            })
        })
    })
})
