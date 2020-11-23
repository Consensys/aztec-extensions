import * as noteAccess from "@aztec/note-access"
const { metadata: metaDataConstructor } = noteAccess
import secp256k1 from "@aztec/secp256k1"
import { note } from "aztec.js"
import BN from "bn.js"
import { ethers } from "ethers"
import nacl from "tweetnacl"
import { AZTEC_JS_DEFAULT_METADATA_PREFIX_LENGTH } from "../chain/aztec/constants"
import { EncryptedViewingKey } from "../chain/aztec/EncryptedViewingKey"
import { bytes32, bytesFixed } from "../utils/regEx"

jest.setTimeout(30000) // timeout for each test in milliseconds

// 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf
const account1 = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000001"
)
const account2 = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000002"
)
const account3 = secp256k1.accountFromPrivateKey(
    "0x0000000000000000000000000000000000000000000000000000000000000003"
)

describe("Note tests", () => {
    test("account", () => {
        const randomAccount = secp256k1.generateAccount()
        expect(randomAccount.privateKey).toMatch(bytesFixed(32))
        expect(randomAccount.publicKey).toMatch(bytesFixed(65))
        expect(randomAccount.address).toMatch(bytesFixed(20))
    })
    test("Different notes with same public key and note value", async () => {
        const note1 = await note.create(account1.publicKey, 1)
        const note2 = await note.create(account1.publicKey, 1)
        expect(note1.k).toEqual(note2.k)
        expect(note1.k.toNumber()).toEqual(1)
        expect(note1.noteHash).toMatch(bytes32)
        expect(note2.noteHash).toMatch(bytes32)
        expect(note1.noteHash).not.toEqual(note2.noteHash)
        expect(note1.owner).toEqual(account1.address)
        expect(note2.owner).toEqual(account1.address)

        expect(note1.exportEphemeralKey()).toMatch(bytesFixed(33))
        expect(note2.exportEphemeralKey()).toMatch(bytesFixed(33))
        expect(note1.exportEphemeralKey()).not.toEqual(
            note2.exportEphemeralKey()
        )

        expect(note1.getView()).toMatch(bytesFixed(69))
        expect(note2.getView()).toMatch(bytesFixed(69))
        expect(note1.getView()).not.toEqual(note2.getView())

        // the notes public keys are different even though the same account was used
        expect(note1.getPublic()).toMatch(bytesFixed(99))
        expect(note2.getPublic()).toMatch(bytesFixed(99))
        expect(note1.getPublic()).not.toEqual(note2.getPublic())
        expect(note1.getPublic()).not.toEqual(account1.publicKey)
    })

    test("two zero value notes", async () => {
        const note1 = await note.createZeroValueNote()
        const note2 = await note.createZeroValueNote()
        expect(note1.k).toEqual(note2.k)
        expect(note1.k.toNumber()).toEqual(0)
        expect(note1.noteHash).toMatch(bytes32)
        expect(note1.noteHash).toEqual(note2.noteHash)
        expect(note1.owner).toEqual("0x")
        expect(note2.owner).toEqual("0x")
    })

    test("Same value but different public keys", async () => {
        const note1 = await note.create(account2.publicKey, 1)
        const note2 = await note.create(account1.publicKey, 1)
        expect(note2.k).toEqual(note1.k)
        expect(note2.k.toNumber()).toEqual(1)
        expect(note1.noteHash).toMatch(bytes32)
        expect(note2.noteHash).toMatch(bytes32)
        expect(note2.noteHash).not.toEqual(note1.noteHash)
    })

    test("Zero value notes with different public keys", async () => {
        const note1 = await note.createZeroValueNote()
        const note2 = await note.create(account1.publicKey, 0)
        expect(note2.k).toEqual(note1.k)
        expect(note2.k.toNumber()).toEqual(0)
        expect(note1.noteHash).toMatch(bytes32)
        expect(note2.noteHash).toMatch(bytes32)
        expect(note2.noteHash).not.toEqual(note1.noteHash)
    })

    describe("Create note with number value", () => {
        test.each`
            test                       | value
            ${"zero"}                  | ${0}
            ${"one"}                   | ${1}
            ${"one million"}           | ${1000000}
            ${"nine million"}          | ${9000000}
            ${"ten million minus two"} | ${9999998}
            ${"ten million minus one"} | ${9999999}
            ${"ten million"}           | ${10000000}
        `("$test $value", async ({ test, value }) => {
            const testNote = await note.create(account1.publicKey, value)
            expect(testNote.k.toNumber()).toEqual(value)
        })
    })
    describe("Create note with BN value", () => {
        test.each`
            test                       | value
            ${"zero"}                  | ${new BN(0)}
            ${"one"}                   | ${new BN(1)}
            ${"ten million minus one"} | ${new BN(9999999)}
            ${"ten million"}           | ${new BN(10000000)}
        `("$test $value", async ({ test, value }) => {
            const testNote = await note.create(account1.publicKey, value)
            expect(testNote.k.toNumber()).toEqual(value.toNumber())
        })
    })
    describe("Fail to create note with value", () => {
        test.each`
            test                             | value                      | errorMsg
            ${"ten million and one"}         | ${10000001}                | ${"x^3 + 3 not a square, malformed input"}
            ${"ten million and one BN"}      | ${new BN(10000001)}        | ${"x^3 + 3 not a square, malformed input"}
            ${"ten million and two"}         | ${10000002}                | ${'The value of "sourceStart" is out of range. It must be <= 32. Received 64'}
            ${"ten million and two BN"}      | ${new BN(10000002)}        | ${'The value of "sourceStart" is out of range. It must be <= 32. Received 64'}
            ${"twenty million and three"}    | ${20000003}                | ${"point not found"}
            ${"twenty million and three BN"} | ${new BN(20000003)}        | ${"point not found"}
            ${"twenty million and four"}     | ${20000004}                | ${"point not found"}
            ${"twenty million"}              | ${20000000}                | ${"point not found"}
            ${"one hundred million"}         | ${100000000}               | ${"point not found"}
            ${"billion"}                     | ${1000000000}              | ${"point not found"}
            ${"max 32 bit number"}           | ${2147483647}              | ${"point not found"}
            ${"trillion"}                    | ${1000000000000}           | ${"point not found"}
            ${"Max 64 bit number"}           | ${Number.MAX_SAFE_INTEGER} | ${"point not found"}
        `("$test $value", async ({ value, errorMsg }) => {
            expect.assertions(1)
            try {
                await note.create(account1.publicKey, value)
            } catch (err) {
                expect(err.message).toMatch(errorMsg)
            }
        })
    })

    describe("Derive notes from", () => {
        let startingNote
        beforeAll(async () => {
            startingNote = await note.create(account1.publicKey, 101)
        })
        test("note public key and account private key", async () => {
            const startingNotePublicKey = startingNote.getPublic()

            const derivedNote = new note.Note(startingNotePublicKey, null)
            await derivedNote.derive(account1.privateKey)

            expect(derivedNote.noteHash).toEqual(startingNote.noteHash)
            expect(derivedNote.k.toNumber()).toEqual(101)
            // the owner is set in Note.fromEventLog, not in Note.derive
            expect(derivedNote.owner).toEqual("0x")
        })
        test("note viewing key", async () => {
            const viewingKey = startingNote.getView()
            const derivedNote = await note.fromViewKey(viewingKey)
            expect(derivedNote.noteHash).toEqual(startingNote.noteHash)
            expect(derivedNote.k.toNumber()).toEqual(101)
            expect(derivedNote.owner).toEqual("0x")
        })
        // test("fail with public key and incorrect account private key", async () => {
        //     const startingNotePublicKey = startingNote.getPublic()
        //
        //     const derivedNote = new note.Note(startingNotePublicKey, null)
        //     await derivedNote.derive(account2.privateKey)
        //
        //     expect(derivedNote.noteHash).not.toEqual(startingNote.noteHash)
        //     expect(derivedNote.k.toNumber()).not.toEqual(101)
        // })
    })

    test("Create linked key pair from private key", async () => {
        // this is a test user account from AZTEC's tests
        const userAccount = {
            // length 42 = 20 bytes
            address: "0xfB95acC8D3870da3C646Ae8c3C621916De8DF42d",
            // length 66 = 32 bytes
            linkedPublicKey:
                "0xa61d17b0dd3095664d264628a6b947721314b6999aa6a73d3c7698f041f78a4d",
            // length 64 with no 0x prefix = 32 bytes
            linkedPrivateKey:
                "e1ec35b90155a633ac75d0508e537a7e00fd908a5295365054001a44b4a0560c",
            // length 66 = 32 bytes
            spendingPublicKey:
                "0x0290e0354caa04c73920339f979cfc932dd3d52ba8210fec34571bb6422930c396",
        }
        const linkedPrivateKeyUInt8Array = ethers.utils.arrayify(
            "0x" + userAccount.linkedPrivateKey
        )
        const linkedKeyPair = nacl.box.keyPair.fromSecretKey(
            linkedPrivateKeyUInt8Array
        )
        const linkedPublicKeyUint8Array = linkedKeyPair.publicKey
        const linkedPublicKey = ethers.utils.hexlify(linkedPublicKeyUint8Array)
        expect(linkedPublicKey).toEqual(userAccount.linkedPublicKey)
    })

    describe("Assign view access to a new note", () => {
        // generate random key pairs for the Curve25519 elliptic curve
        const keyPair1 = nacl.box.keyPair()
        const keyPair2 = nacl.box.keyPair()
        let startingNote
        let metadataObj
        test("Account 1 creates note that is viewable by account 2 and account 3", async () => {
            const account2LinkedAccount = {
                // address from the secp256k1 elliptic curve
                address: account2.address,
                linkedPublicKey: ethers.utils.hexlify(keyPair1.publicKey),
            }
            const account3LinkedAccount = {
                address: account3.address,
                linkedPublicKey: ethers.utils.hexlify(keyPair2.publicKey),
            }
            expect(keyPair1.secretKey).not.toEqual(keyPair2.secretKey)
            startingNote = await note.create(
                account1.publicKey,
                201,
                [account2LinkedAccount, account3LinkedAccount],
                undefined
            )
            metadataObj = metaDataConstructor(
                startingNote.metaData.slice(
                    AZTEC_JS_DEFAULT_METADATA_PREFIX_LENGTH + 2
                )
            )
        })
        let account2DecryptedViewingKey
        test("Account 2 can see the value", async () => {
            const allowedAccess = metadataObj.getAccess(account2.address)
            const encryptedViewingKey = allowedAccess.viewingKey
            expect(encryptedViewingKey).toMatch(bytesFixed(210))
            const viewingKey = EncryptedViewingKey.fromEncryptedKey(
                encryptedViewingKey
            )
            account2DecryptedViewingKey = viewingKey.decrypt(keyPair1.secretKey)
            expect(account2DecryptedViewingKey).toMatch(bytesFixed(69))
            const derivedNote = await note.fromViewKey(
                account2DecryptedViewingKey
            )
            expect(derivedNote.k.toNumber()).toEqual(201)
        })
        test("Account 3 can see the value", async () => {
            const allowedAccess = metadataObj.getAccess(account3.address)
            const viewingKey = EncryptedViewingKey.fromEncryptedKey(
                allowedAccess.viewingKey
            )
            const account3DecryptedViewingKey = viewingKey.decrypt(
                keyPair2.secretKey
            )
            expect(account3DecryptedViewingKey).toMatch(bytesFixed(69))
            const derivedNote = await note.fromViewKey(
                account3DecryptedViewingKey
            )
            expect(derivedNote.k.toNumber()).toEqual(201)

            // the decrypted viewing key is the same for each linked account and the note owner
            expect(account3DecryptedViewingKey).toEqual(
                account2DecryptedViewingKey
            )
            const ownerViewingKey = startingNote.getView()
            expect(ownerViewingKey).toEqual(account2DecryptedViewingKey)
        })
        test("Failed to decrypt viewing key with wrong linked account private key", async () => {
            expect.assertions(2)
            const allowedAccess = metadataObj.getAccess(account2.address)
            const viewingKey = EncryptedViewingKey.fromEncryptedKey(
                allowedAccess.viewingKey
            )
            try {
                const decryptedViewingKey = viewingKey.decrypt(
                    keyPair2.secretKey
                )
            } catch (err) {
                expect(err).toBeInstanceOf(Error)
                expect(err.message).toMatch(
                    "Failed to decrypt viewing key with private key"
                )
            }
        })
        test("Failed to decrypt viewing key with Ethereum private key", async () => {
            expect.assertions(2)
            const allowedAccess = metadataObj.getAccess(account2.address)
            const viewingKey = EncryptedViewingKey.fromEncryptedKey(
                allowedAccess.viewingKey
            )
            try {
                const decryptedViewingKey = viewingKey.decrypt(
                    ethers.utils.arrayify(account2.privateKey)
                )
            } catch (err) {
                expect(err).toBeInstanceOf(Error)
                expect(err.message).toMatch(
                    "Failed to decrypt viewing key with private key"
                )
            }
        })
    })
})
