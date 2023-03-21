/* eslint-disable @typescript-eslint/naming-convention */
// interface Addresses {
//   REBALANCER: string;
//   UniswapV3Factory: string;
//   FlypeFeeTreasury: string;
// }

export interface Addresses {
  REBALANCER: string;
  UniswapV3Factory: string;
  FlypeMaxiRouter: string;
  FlypeMaxiFactoryV1: string;
  WETH: string;
  FlypeMaxiV1WethVault: string;
  FlypeFeeTreasury: string;
}

export const getAddresses = (network: string): Addresses => {
  switch (network) {
    case "hardhat":
      return {
        REBALANCER: "0xe33853656D5aa16e3FdaDEA5A297cd3ea5cC3Af9",
        UniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        FlypeMaxiRouter: "0x23deAbFcF347B43400337C683bceCF3aF790a788",
        FlypeMaxiFactoryV1: "0xED1831F634F5433Ae786Fce06356071e96Fc4644",
        WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
        FlypeMaxiV1WethVault: "0xAC6d13c13db0FABf95D1ab53Ec48Fc09D85BFc49",
        FlypeFeeTreasury: "0xe33853656D5aa16e3FdaDEA5A297cd3ea5cC3Af9",
      };
    case "mainnet":
      return {
        REBALANCER: "0xc980c7bFe006C72381268F1ea5B08563E04DB25d",
        UniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        FlypeMaxiRouter: "",
        FlypeMaxiFactoryV1: "",
        WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        FlypeMaxiV1WethVault: "",
        FlypeFeeTreasury: "0xc980c7bFe006C72381268F1ea5B08563E04DB25d",
      };
    case "polygon":
      return {
        REBALANCER: "0xd21b677cfAd474E29f0aF3003e5cA553305079dF",
        UniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        FlypeMaxiRouter: "",
        FlypeMaxiFactoryV1: "0x2C640BEb9a4a624B2d2598280383240305550399",
        WETH: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
        FlypeMaxiV1WethVault: "",
        FlypeFeeTreasury: "0xd21b677cfAd474E29f0aF3003e5cA553305079dF",
      };
    // case "optimism":
    //   return {
    //     REBALANCER: "",
    //     UniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    //     FlypeMaxiRouter: "",
    //     FlypeMaxiFactoryV1: "",
    //     WETH: "0x4200000000000000000000000000000000000006",
    //     FlypeMaxiV1WethVault: "",
    //     FlypeFeeTreasury: "",
    //   };
    case "arbitrum":
      return {
        REBALANCER: "0xe33853656D5aa16e3FdaDEA5A297cd3ea5cC3Af9",
        UniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        FlypeMaxiRouter: "0x23deAbFcF347B43400337C683bceCF3aF790a788",
        FlypeMaxiFactoryV1: "0xED1831F634F5433Ae786Fce06356071e96Fc4644",
        WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
        FlypeMaxiV1WethVault: "",
        FlypeFeeTreasury: "0xe33853656D5aa16e3FdaDEA5A297cd3ea5cC3Af9",
      };
    case "goerli":
      return {
        REBALANCER: "0xd5B4a83e8CF168Dc340AA04a9C0b8c5DAF6666cD",
        UniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        FlypeMaxiRouter: "",
        FlypeMaxiFactoryV1: "",
        WETH: "0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6",
        FlypeMaxiV1WethVault: "",
        FlypeFeeTreasury: "0xd5B4a83e8CF168Dc340AA04a9C0b8c5DAF6666cD",
      };
    default:
      throw new Error(`No addresses for Network: ${network}`);
  }
};
