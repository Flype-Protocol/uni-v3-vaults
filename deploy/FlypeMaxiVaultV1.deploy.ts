import { deployments, getNamedAccounts } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { getAddresses } from "../src/addresses";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  if (
    hre.network.name === "mainnet" ||
    hre.network.name === "polygon" ||
    // hre.network.name === "optimism" ||
    hre.network.name === "arbitrum"
  ) {
    console.log(
      `!! Deploying FlypeMaxiVaultV1 to ${hre.network.name}. Hit ctrl + c to abort`
    );
    await new Promise((r) => setTimeout(r, 20000));
  }

  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  const addresses = getAddresses(hre.network.name);

  await deploy("FlypeMaxiVaultV1", {
    from: deployer,
    args: [addresses.REBALANCER, addresses.FlypeFeeTreasury],
    log: hre.network.name !== "hardhat" ? true : false,
  });
};

func.skip = async (hre: HardhatRuntimeEnvironment) => {
  const shouldSkip =
    hre.network.name === "mainnet" ||
    hre.network.name === "polygon" ||
    // hre.network.name === "optimism" ||
    hre.network.name === "arbitrum" ||
    hre.network.name === "goerli";
  return shouldSkip ? true : false;
};

func.tags = ["FlypeMaxiVaultV1"];

export default func;
