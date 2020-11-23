export const bytes = /^0x([A-Fa-f0-9]{1,})$/

export const bytesFixed = (x: number) =>
    new RegExp("^0x([A-Fa-f0-9]{" + x * 2 + "})$")

export const bytes32 = bytesFixed(32)
export const ethereumAddress = bytesFixed(20)
export const transactionHash = bytes32

export const uuid4 = /[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}/
