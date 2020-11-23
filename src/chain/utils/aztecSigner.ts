import { constants } from "@aztec/dev-utils"
import { signer } from "aztec.js"
import { keccak256 } from "web3-utils"

const HOLD_SIGNATURE = {
    types: {
        HoldSignature: [
            {
                name: "proofHash",
                type: "bytes32",
            },
            {
                name: "notary",
                type: "address",
            },
            {
                name: "expirationDateTime",
                type: "uint256",
            },
            {
                name: "lockHash",
                type: "bytes32",
            },
        ],
        EIP712Domain: constants.eip712.EIP712_DOMAIN,
    },
    primaryType: "HoldSignature",
}

const RELEASE_SIGNATURE = {
    types: {
        ReleaseSignature: [
            {
                name: "holdId",
                type: "bytes32",
            },
        ],
        EIP712Domain: constants.eip712.EIP712_DOMAIN,
    },
    primaryType: "ReleaseSignature",
}

const aztecSigner = signer

aztecSigner.signHoldForProof = (
    verifyingContract,
    proofOutputs: string,
    notary: string,
    expirationDateTime: number,
    lockHash: string,
    privateKey: string,
    flip: boolean = false
): string => {
    const domain = signer.generateZKAssetDomainParams(verifyingContract)
    const proofHash = keccak256(proofOutputs)

    const message = {
        proofHash,
        notary,
        expirationDateTime,
        lockHash,
    }
    const { unformattedSignature } = signer.signTypedData(
        domain,
        HOLD_SIGNATURE,
        message,
        privateKey
    )
    const signature = `0x${unformattedSignature.slice(0, 130)}` // extract r, s, v (v is just 1 byte, 2 characters)
    if (flip) {
        return signer.makeReplaySignature(signature)
    }
    return signature
}

aztecSigner.signReleaseForProofHold = (
    verifyingContract,
    holdId: string,
    privateKey: string,
    flip: boolean = false
): string => {
    const domain = signer.generateZKAssetDomainParams(verifyingContract)

    const message = {
        holdId,
    }
    const { unformattedSignature } = signer.signTypedData(
        domain,
        RELEASE_SIGNATURE,
        message,
        privateKey
    )
    const signature = `0x${unformattedSignature.slice(0, 130)}` // extract r, s, v (v is just 1 byte, 2 characters)
    if (flip) {
        return signer.makeReplaySignature(signature)
    }
    return signature
}

export { aztecSigner }
