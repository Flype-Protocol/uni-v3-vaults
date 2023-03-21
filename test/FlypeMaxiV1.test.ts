import { expect } from "chai";
import { BigNumber } from "bignumber.js";
import { ethers, network } from "hardhat";

import {
  IERC20,
  IUniswapV3Factory,
  IUniswapV3Pool,
  SwapTest,
  FlypeMaxiVaultV1,
  FlypeMaxiFactoryV1,
  EIP173Proxy,
} from "../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

// eslint-disable-next-line
BigNumber.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });

// Returns the sqrt price as a 64x96
function encodePriceSqrt(reserve1: string, reserve0: string) {
  return new BigNumber(reserve1)
    .div(reserve0)
    .sqrt()
    .multipliedBy(new BigNumber(2).pow(96))
    .integerValue(3)
    .toString();
}

function position(address: string, lowerTick: number, upperTick: number) {
  return ethers.utils.solidityKeccak256(
    ["address", "int24", "int24"],
    [address, lowerTick, upperTick]
  );
}

describe("FlypeMaxiVaultV1", function () {
  this.timeout(0);

  let uniswapFactory: IUniswapV3Factory;
  let uniswapPool: IUniswapV3Pool;

  let token0: IERC20;
  let token1: IERC20;
  let user0: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let swapTest: SwapTest;
  let vault: FlypeMaxiVaultV1;
  let FlypeMaxiFactory: FlypeMaxiFactoryV1;
  let REBALANCER: SignerWithAddress;
  let uniswapPoolAddress: string;
  let implementationAddress: string;

  before(async function () {
    [user0, user1, user2, REBALANCER] = await ethers.getSigners();

    const swapTestFactory = await ethers.getContractFactory("SwapTest");
    swapTest = (await swapTestFactory.deploy()) as SwapTest;
  });

  beforeEach(async function () {
    // Create uniswapV3Factory mock
    const uniswapV3Factory = await ethers.getContractFactory(
      "UniswapV3Factory"
    );
    const uniswapDeploy = await uniswapV3Factory.deploy();
    uniswapFactory = (await ethers.getContractAt(
      "IUniswapV3Factory",
      uniswapDeploy.address
    )) as IUniswapV3Factory;

    // Create ERC20 mock
    const mockERC20Factory = await ethers.getContractFactory("MockERC20");
    token0 = (await mockERC20Factory.deploy()) as IERC20;
    token1 = (await mockERC20Factory.deploy()) as IERC20;

    // Approve ERC20 for swapTest
    await token0.approve(
      swapTest.address,
      ethers.utils.parseEther("10000000000000")
    );
    await token1.approve(
      swapTest.address,
      ethers.utils.parseEther("10000000000000")
    );

    // Sort token0 & token1 so it follows the same order as Uniswap & the FlypeMaxiFactoryV1
    if (
      ethers.BigNumber.from(token0.address).gt(
        ethers.BigNumber.from(token1.address)
      )
    ) {
      const tmp = token0;
      token0 = token1;
      token1 = tmp;
    }

    // Create pool
    await uniswapFactory.createPool(token0.address, token1.address, "3000");
    uniswapPoolAddress = await uniswapFactory.getPool(
      token0.address,
      token1.address,
      "3000"
    );
    uniswapPool = (await ethers.getContractAt(
      "IUniswapV3Pool",
      uniswapPoolAddress
    )) as IUniswapV3Pool;
    await uniswapPool.initialize(encodePriceSqrt("1", "1"));
    await uniswapPool.increaseObservationCardinalityNext("15");

    // Deploy FlypeMaxiVaultV1
    const vaultV1Factory = await ethers.getContractFactory("FlypeMaxiVaultV1");

    const vaultImplementation = await vaultV1Factory.deploy(
      await REBALANCER.getAddress(), // REBALANCER contract address
      await user0.getAddress() // DAO treasury address
    );

    implementationAddress = vaultImplementation.address;

    // Deploy FlypeMaxiFactoryV1
    const FlypeMaxiFactoryFactory = await ethers.getContractFactory(
      "FlypeMaxiFactoryV1"
    );

    FlypeMaxiFactory = (await FlypeMaxiFactoryFactory.deploy(
      uniswapFactory.address // uniswapV3Factory contract address
    )) as FlypeMaxiFactoryV1;

    // Initialize the FlypeMaxiVaultV1 implementation
    await FlypeMaxiFactory.initialize(
      implementationAddress,
      await user0.getAddress()
    );

    // Create new vault
    await FlypeMaxiFactory.deployVault(
      token0.address, // Token A of the vault
      token1.address, // Token B of the vault
      3000, // Pool's fee tier
      await user0.getAddress(), // DAO gnosis safe address
      0, // Manager fee up-to 17.5% (1750)
      -887220, // lowerTick of the vault, min: -887220
      887220 // upperTick of the vault, max: 887220
    );

    // Get vaults deployers
    const deployers = await FlypeMaxiFactory.getDeployers();

    const deployer = deployers[0];

    // Get valuts created by deployer[0]
    const vaults = await FlypeMaxiFactory.getVaults(deployer);

    vault = (await ethers.getContractAt(
      "FlypeMaxiVaultV1",
      vaults[0]
    )) as FlypeMaxiVaultV1;

    // Get Flype protocol's fee
    const FlypeMaxiFee = await vault.FlypeMaxiFeeBPS();
    expect(FlypeMaxiFee.toString()).to.equal("250");
  });

  describe("Before liquidity deposited", function () {
    // Approve ERC 20 token for vault.address
    beforeEach(async function () {
      await token0.approve(vault.address, ethers.utils.parseEther("1000000"));
      await token1.approve(vault.address, ethers.utils.parseEther("1000000"));
    });

    describe("deposit", function () {
      it("should deposit funds into FlypeMaxiVaultV1", async function () {
        // Get the mint amount
        const result = await vault.getMintAmounts(
          ethers.utils.parseEther("1"),
          ethers.utils.parseEther("1")
        );

        // Execute mint function
        await vault.mint(result.mintAmount, await user0.getAddress());

        expect(await token0.balanceOf(uniswapPool.address)).to.be.gt(0);
        expect(await token1.balanceOf(uniswapPool.address)).to.be.gt(0);

        // Get position's liquidity from Uniswap
        const [liquidity] = await uniswapPool.positions(
          position(vault.address, -887220, 887220)
        );

        expect(liquidity).to.be.gt(0);
        const supply = await vault.totalSupply();
        expect(supply).to.be.gt(0);

        // Get mint amount
        const result2 = await vault.getMintAmounts(
          ethers.utils.parseEther("0.5"),
          ethers.utils.parseEther("1")
        );

        await vault.mint(result2.mintAmount, await user0.getAddress());
        const [liquidity2] = await uniswapPool.positions(
          position(vault.address, -887220, 887220)
        );

        expect(liquidity2).to.be.gt(liquidity);

        // Transfer LP token to account 1
        await vault.transfer(
          await user1.getAddress(),
          ethers.utils.parseEther("1")
        );

        // Approve LP token transfer from user1 to user0
        await vault
          .connect(user1)
          .approve(await user0.getAddress(), ethers.utils.parseEther("1"));

        // Transfer from user1 to user0
        await vault
          .connect(user0)
          .transferFrom(
            await user1.getAddress(),
            await user0.getAddress(),
            ethers.utils.parseEther("1")
          );

        const decimals = await vault.decimals();

        // Get LP token Symbol
        const symbol = await vault.symbol();

        // Get LP token name
        const name = await vault.name();
        console.log("name", name, symbol, decimals);

        expect(symbol).to.equal("FMXI-1");
        expect(decimals).to.equal(18);
        expect(name).to.equal("FLYPE-MAXI - TOKEN/TOKEN");
      });

      it("should fail with restricted manager minting", async () => {
        const result = await vault.getMintAmounts(
          ethers.utils.parseEther("1"),
          ethers.utils.parseEther("1")
        );

        // Make the vault restricted to manager only
        await vault.toggleRestrictMint();
        await expect(
          vault.connect(user1).mint(result.mintAmount, await user0.getAddress())
        ).to.be.revertedWith("restricted");

        await vault
          .connect(user0)
          .mint(result.mintAmount, await user0.getAddress());
      });
    });

    describe("onlyREBALANCER", function () {
      it("should fail if not called by REBALANCER", async function () {
        await expect(
          vault.connect(user1).rebalance(
            encodePriceSqrt("10", "1"), // swapThresholdPrice
            1000, // swapAmountBPS
            true, // zeroForOne
            10, // feeAmount
            token0.address // paymentToken
          )
        ).to.be.reverted;
      });

      it("should fail if no fees earned", async function () {
        await expect(
          vault
            .connect(REBALANCER)
            .rebalance(
              encodePriceSqrt("10", "1"),
              1000,
              true,
              10,
              token0.address
            )
        ).to.be.reverted;
      });
    });

    describe("onlyManager", function () {
      it("should be possible to executiveRebalance before deposits", async function () {
        await vault.executiveRebalance(-887220, 0, 0, 0, false);
        await vault.executiveRebalance(-887220, 887220, 0, 0, false);
      });

      it("should fail if not called by manager", async function () {
        await expect(
          vault
            .connect(REBALANCER)
            .updateManagerParams(
              -1,
              ethers.constants.AddressZero,
              300,
              5000,
              5000
            )
        ).to.be.reverted;

        await expect(
          vault.connect(REBALANCER).transferOwnership(await user1.getAddress())
        ).to.be.reverted;
        await expect(vault.connect(REBALANCER).renounceOwnership()).to.be
          .reverted;
      });
    });

    describe("After liquidity deposited", function () {
      beforeEach(async function () {
        const result = await vault.getMintAmounts(
          ethers.utils.parseEther("1"),
          ethers.utils.parseEther("1")
        );
        await vault.mint(result.mintAmount, await user0.getAddress());
      });

      describe("withdrawal", function () {
        it("should burn LP tokens and withdraw funds", async function () {
          // remove liquidity from vault
          await vault.burn(
            (await vault.totalSupply()).div("2"),
            await user0.getAddress()
          );

          const [liquidity2] = await uniswapPool.positions(
            position(vault.address, -887220, 887220)
          );

          expect(liquidity2).to.be.gt(0);
          expect(await vault.totalSupply()).to.be.gt(0);
          expect(await vault.balanceOf(await user0.getAddress())).to.equal(
            ethers.utils.parseEther("0.5")
          );
        });
      });

      describe("after fees earned on trades", function () {
        beforeEach(async function () {
          // create mockup trades in order to create trading fees

          await swapTest.washTrade(
            uniswapPool.address,
            "50000000000000",
            100,
            2
          );

          await swapTest.washTrade(
            uniswapPool.address,
            "50000000000000",
            100,
            3
          );

          await swapTest.washTrade(
            uniswapPool.address,
            "50000000000000",
            100,
            3
          );
          await swapTest.washTrade(
            uniswapPool.address,
            "50000000000000",
            100,
            3
          );
        });

        describe("reinvest fees", function () {
          it("should redeposit fees with a rebalance", async function () {
            // get liquidity from uniswap pool
            const [liquidityOld] = await uniswapPool.positions(
              position(vault.address, -887220, 887220)
            );

            const rebalancerBalanceBefore = await token1.balanceOf(
              await REBALANCER.getAddress()
            );

            await expect(
              vault
                .connect(REBALANCER)
                .rebalance(
                  encodePriceSqrt("1", "1"),
                  5000,
                  true,
                  10,
                  token0.address
                )
            ).to.be.reverted;

            const tx = await vault.updateManagerParams(
              -1, // newManagerFeeBPS
              ethers.constants.AddressZero, // newManagerTreasury
              "1000", // maxRebalancePayoutFeeBPS
              -1, // newSlippageBPS
              -1 // newSlippageInterval
            );

            if (network.provider && user0.provider && tx.blockHash) {
              const block = await user0.provider.getBlock(tx.blockHash);
              const executionTime = block.timestamp + 300;
              await network.provider.send("evm_mine", [executionTime]);
            }

            const { sqrtPriceX96 } = await uniswapPool.slot0();
            const slippagePrice = sqrtPriceX96.sub(
              sqrtPriceX96.div(ethers.BigNumber.from("25"))
            );

            await vault
              .connect(REBALANCER)
              .rebalance(slippagePrice, 5000, true, 5, token1.address);

            const rebalancerBalanceAfter = await token1.balanceOf(
              await REBALANCER.getAddress()
            );

            expect(rebalancerBalanceAfter).to.be.gt(rebalancerBalanceBefore);
            expect(
              Number(rebalancerBalanceAfter.sub(rebalancerBalanceBefore))
            ).to.be.equal(5);

            const [liquidityNew] = await uniswapPool.positions(
              position(vault.address, -887220, 887220)
            );

            expect(liquidityNew).to.be.gt(liquidityOld);
          });
        });

        describe("executive rebalance", function () {
          it("should change the ticks and redeposit", async function () {
            const [liquidityOld] = await uniswapPool.positions(
              position(vault.address, -887220, 887220)
            );

            const tx = await vault
              .connect(user0)
              .updateManagerParams(
                -1,
                ethers.constants.AddressZero,
                "5000",
                -1,
                -1
              );
            await tx.wait();
            await swapTest.washTrade(
              uniswapPool.address,
              "500000000000000000",
              100,
              2
            );
            await token1.transfer(vault.address, ethers.utils.parseEther("1"));
            if (network.provider && user0.provider && tx.blockHash) {
              const block = await user0.provider.getBlock(tx.blockHash);
              const executionTime = block.timestamp + 300;
              await network.provider.send("evm_mine", [executionTime]);
            }
            const lowerTickBefore = await vault.lowerTick();
            const upperTickBefore = await vault.upperTick();
            expect(lowerTickBefore).to.equal(-887220);
            expect(upperTickBefore).to.equal(887220);
            const { sqrtPriceX96 } = await uniswapPool.slot0();
            const slippagePrice = sqrtPriceX96.add(
              sqrtPriceX96.div(ethers.BigNumber.from("25"))
            );

            await vault
              .connect(user0)
              .executiveRebalance(-443580, 443580, slippagePrice, 5000, false);

            const lowerTickAfter = await vault.lowerTick();
            const upperTickAfter = await vault.upperTick();
            expect(lowerTickAfter).to.equal(-443580);
            expect(upperTickAfter).to.equal(443580);

            const [liquidityOldAfter] = await uniswapPool.positions(
              position(vault.address, -887220, 887220)
            );
            expect(liquidityOldAfter).to.equal("0");
            expect(liquidityOldAfter).to.be.lt(liquidityOld);

            const [liquidityNew] = await uniswapPool.positions(
              position(vault.address, -443580, 443580)
            );
            expect(liquidityNew).to.be.gt(liquidityOld);

            await vault.burn(
              await vault.totalSupply(),
              await user0.getAddress()
            );

            const contractBalance0 = await token0.balanceOf(vault.address);
            const contractBalance1 = await token1.balanceOf(vault.address);

            const FlypeMaxiBalance0 = await vault.FlypeMaxiBalance0();
            const FlypeMaxiBalance1 = await vault.FlypeMaxiBalance1();

            expect(contractBalance0).to.equal(FlypeMaxiBalance0);
            expect(contractBalance1).to.equal(FlypeMaxiBalance1);
          });

          it("should receive same amounts on burn as spent on mint (if no trading)", async function () {
            const user1Address = await user1.getAddress();
            const user2Address = await user2.getAddress();
            await token0.transfer(
              user2Address,
              ethers.utils.parseEther("1000")
            );
            await token1.transfer(
              user2Address,
              ethers.utils.parseEther("1000")
            );
            await token0.transfer(
              user1Address,
              ethers.utils.parseEther("1000")
            );
            await token1.transfer(
              user1Address,
              ethers.utils.parseEther("1000")
            );
            await token0
              .connect(user1)
              .approve(vault.address, ethers.constants.MaxUint256);
            await token1
              .connect(user1)
              .approve(vault.address, ethers.constants.MaxUint256);
            const result = await vault.getMintAmounts(
              ethers.utils.parseEther("9"),
              ethers.utils.parseEther("9")
            );
            await vault.connect(user1).mint(result.mintAmount, user1Address);
            await token0
              .connect(user2)
              .approve(vault.address, ethers.constants.MaxUint256);
            await token1
              .connect(user2)
              .approve(vault.address, ethers.constants.MaxUint256);
            const result2 = await vault.getMintAmounts(
              ethers.utils.parseEther("10"),
              ethers.utils.parseEther("10")
            );
            await vault.connect(user2).mint(result2.mintAmount, user2Address);

            const balanceAfterMint0 = await token0.balanceOf(user2Address);
            const balanceAfterMint1 = await token0.balanceOf(user2Address);

            expect(
              ethers.utils.parseEther("1000").sub(balanceAfterMint0.toString())
            ).to.be.gt(ethers.BigNumber.from("1"));
            expect(
              ethers.utils.parseEther("1000").sub(balanceAfterMint1.toString())
            ).to.be.gt(ethers.BigNumber.from("1"));

            await vault
              .connect(user2)
              .burn(await vault.balanceOf(user2Address), user2Address);
            const balanceAfterBurn0 = await token0.balanceOf(user2Address);
            const balanceAfterBurn1 = await token0.balanceOf(user2Address);
            expect(
              ethers.utils.parseEther("1000").sub(balanceAfterBurn1.toString())
            ).to.be.lte(ethers.BigNumber.from("2"));
            expect(
              ethers.utils.parseEther("1000").sub(balanceAfterBurn0.toString())
            ).to.be.lte(ethers.BigNumber.from("2"));
            expect(
              ethers.utils.parseEther("1000").sub(balanceAfterBurn1.toString())
            ).to.be.gte(ethers.constants.Zero);
            expect(
              ethers.utils.parseEther("1000").sub(balanceAfterBurn0.toString())
            ).to.be.gte(ethers.constants.Zero);
          });
        });
      });

      describe("simulate price moves and deposits, prove all value is returned on burn", function () {
        it("does not get tokens stuck in contract", async function () {
          await swapTest.washTrade(
            uniswapPool.address,
            "50000000000000000000000",
            100,
            3
          );
          await swapTest.washTrade(
            uniswapPool.address,
            "50000000000000000000000",
            100,
            3
          );
          const { sqrtPriceX96 } = await uniswapPool.slot0();

          const slippagePrice = sqrtPriceX96.sub(
            sqrtPriceX96.div(ethers.BigNumber.from("25"))
          );
          await expect(
            vault
              .connect(REBALANCER)
              .rebalance(slippagePrice, 1000, true, 10, token0.address)
          ).to.be.reverted;

          const tx = await vault
            .connect(user0)
            .updateManagerParams(
              -1,
              ethers.constants.AddressZero,
              "5000",
              -1,
              -1
            );
          if (network.provider && user0.provider && tx.blockHash) {
            const block = await user0.provider.getBlock(tx.blockHash);
            const executionTime = block.timestamp + 300;
            await network.provider.send("evm_mine", [executionTime]);
          }
          await vault
            .connect(REBALANCER)
            .rebalance(0, 0, true, 2, token0.address);

          let contractBalance0 = await token0.balanceOf(vault.address);
          let contractBalance1 = await token1.balanceOf(vault.address);
          // console.log(contractBalance0.toString(), contractBalance1.toString());
          await token0.transfer(await user1.getAddress(), "10000000000");
          await token1.transfer(await user1.getAddress(), "10000000000");
          await token0.connect(user1).approve(vault.address, "10000000000000");
          await token1.connect(user1).approve(vault.address, "10000000000000");
          const result = await vault.getMintAmounts(1000000, 1000000);
          await vault
            .connect(user1)
            .mint(result.mintAmount, await user1.getAddress());

          contractBalance0 = await token0.balanceOf(vault.address);
          contractBalance1 = await token1.balanceOf(vault.address);
          // console.log(contractBalance0.toString(), contractBalance1.toString());

          await swapTest.washTrade(uniswapPool.address, "50000", 100, 3);
          const tx2 = await swapTest.washTrade(
            uniswapPool.address,
            "50000",
            100,
            3
          );
          await tx2.wait();
          if (network.provider && tx2.blockHash && user0.provider) {
            const block = await user0.provider.getBlock(tx2.blockHash);
            const executionTime = block.timestamp + 300;
            await network.provider.send("evm_mine", [executionTime]);
          }
          const { sqrtPriceX96: p2 } = await uniswapPool.slot0();
          const slippagePrice2 = p2.sub(p2.div(ethers.BigNumber.from("50")));
          await vault
            .connect(REBALANCER)
            .rebalance(slippagePrice2, 5000, true, 1, token0.address);
          contractBalance0 = await token0.balanceOf(vault.address);
          contractBalance1 = await token1.balanceOf(vault.address);
          // console.log(contractBalance0.toString(), contractBalance1.toString());

          // TEST MINT/BURN should return same amount
          await token0.transfer(await user2.getAddress(), "100000000000");
          await token1.transfer(await user2.getAddress(), "100000000000");
          await token0
            .connect(user2)
            .approve(vault.address, "1000000000000000");
          await token1
            .connect(user2)
            .approve(vault.address, "1000000000000000");
          const preBalance0 = await token0.balanceOf(await user2.getAddress());
          const preBalance1 = await token1.balanceOf(await user2.getAddress());
          const preBalanceG = await vault.balanceOf(await user2.getAddress());
          const mintAmounts = await vault.getMintAmounts(
            "90000000002",
            "90000000002"
          );

          await vault
            .connect(user2)
            .mint(mintAmounts.mintAmount, await user2.getAddress());
          const intermediateBalance0 = await token0.balanceOf(
            await user2.getAddress()
          );
          const intermediateBalance1 = await token1.balanceOf(
            await user2.getAddress()
          );
          const intermediateBalanceG = await vault.balanceOf(
            await user2.getAddress()
          );

          expect(preBalance0.sub(intermediateBalance0)).to.equal(
            mintAmounts.amount0
          );
          expect(preBalance1.sub(intermediateBalance1)).to.equal(
            mintAmounts.amount1
          );
          expect(intermediateBalanceG.sub(preBalanceG)).to.equal(
            mintAmounts.mintAmount
          );
          await vault
            .connect(user2)
            .burn(
              await vault.balanceOf(await user2.getAddress()),
              await user2.getAddress()
            );
          const postBalance0 = await token0.balanceOf(await user2.getAddress());
          const postBalance1 = await token1.balanceOf(await user2.getAddress());

          expect(preBalance0.sub(postBalance0)).to.be.lte(
            ethers.BigNumber.from("2")
          );
          expect(preBalance0.sub(postBalance0)).to.be.gte(
            ethers.constants.Zero
          );
          expect(preBalance1.sub(postBalance1)).to.be.lte(
            ethers.BigNumber.from("2")
          );
          expect(preBalance1.sub(postBalance1)).to.be.gte(
            ethers.constants.Zero
          );

          await vault
            .connect(user1)
            .burn(
              await vault.balanceOf(await user1.getAddress()),
              await user1.getAddress()
            );

          contractBalance0 = await token0.balanceOf(vault.address);
          contractBalance1 = await token1.balanceOf(vault.address);
          // console.log(contractBalance0.toString(), contractBalance1.toString());

          await vault
            .connect(user0)
            .burn(await vault.totalSupply(), await user0.getAddress());

          await vault.withdrawFlypeMaxiBalance();

          contractBalance0 = await token0.balanceOf(vault.address);
          contractBalance1 = await token1.balanceOf(vault.address);

          expect(contractBalance0).to.equal(0);
          expect(contractBalance1).to.equal(0);
        });
      });
      describe("manager fees, withdrawals, and ownership", function () {
        it("should handle manager fees and ownership", async function () {
          for (let i = 0; i < 3; i++) {
            await swapTest.washTrade(uniswapPool.address, "50000", 100, 3);
            await swapTest.washTrade(uniswapPool.address, "50000", 100, 3);
          }
          const { sqrtPriceX96 } = await uniswapPool.slot0();
          const slippagePrice = sqrtPriceX96.sub(
            sqrtPriceX96.div(ethers.BigNumber.from("25"))
          );
          await expect(
            vault
              .connect(REBALANCER)
              .rebalance(slippagePrice, 1000, true, 2, token0.address)
          ).to.be.reverted;
          const tx = await vault
            .connect(user0)
            .updateManagerParams(
              -1,
              ethers.constants.AddressZero,
              "9000",
              -1,
              -1
            );
          await tx.wait();
          if (network.provider && tx.blockHash && user0.provider) {
            const block = await user0.provider.getBlock(tx.blockHash);
            const executionTime = block.timestamp + 300;
            await network.provider.send("evm_mine", [executionTime]);
          }
          await vault
            .connect(user0)
            .updateManagerParams("5000", await user1.getAddress(), -1, -1, -1);
          await vault
            .connect(REBALANCER)
            .rebalance(slippagePrice, 5000, true, 2, token0.address);

          const treasuryBal0 = await token0.balanceOf(await user1.getAddress());
          const treasuryBal1 = await token1.balanceOf(await user1.getAddress());

          await vault.withdrawManagerBalance();

          const treasuryBalEnd0 = await token0.balanceOf(
            await user1.getAddress()
          );
          const treasuryBalEnd1 = await token1.balanceOf(
            await user1.getAddress()
          );

          expect(treasuryBalEnd0).to.be.gt(treasuryBal0);
          expect(treasuryBalEnd1).to.be.gt(treasuryBal1);

          const bal0End = await vault.managerBalance0();
          const bal1End = await vault.managerBalance1();

          expect(bal0End).to.equal(ethers.constants.Zero);
          expect(bal1End).to.equal(ethers.constants.Zero);

          const FlypeMaxiBal0 = await token0.balanceOf(
            await user0.getAddress()
          );
          const FlypeMaxiBal1 = await token1.balanceOf(
            await user0.getAddress()
          );

          await vault.withdrawFlypeMaxiBalance();

          const FlypeMaxiBalEnd0 = await token0.balanceOf(
            await user0.getAddress()
          );
          const FlypeMaxiBalEnd1 = await token1.balanceOf(
            await user0.getAddress()
          );

          expect(FlypeMaxiBalEnd0).to.be.gt(FlypeMaxiBal0);
          expect(FlypeMaxiBalEnd1).to.be.gt(FlypeMaxiBal1);

          const FlypeMaxiLeft0 = await vault.FlypeMaxiBalance0();
          const FlypeMaxiLeft1 = await vault.FlypeMaxiBalance1();

          expect(FlypeMaxiLeft0).to.equal(ethers.constants.Zero);
          expect(FlypeMaxiLeft1).to.equal(ethers.constants.Zero);

          const treasuryStart = await vault.managerTreasury();
          expect(treasuryStart).to.equal(await user1.getAddress());
          await expect(vault.connect(REBALANCER).renounceOwnership()).to.be
            .reverted;
          const manager = await vault.manager();
          expect(manager).to.equal(await user0.getAddress());
          await vault
            .connect(user0)
            .transferOwnership(await user1.getAddress());
          const manager2 = await vault.manager();
          expect(manager2).to.equal(await user1.getAddress());
          await vault.connect(user1).renounceOwnership();
          const treasuryEnd = await vault.managerTreasury();
          expect(treasuryEnd).to.equal(ethers.constants.AddressZero);
          const lastManager = await vault.manager();
          expect(lastManager).to.equal(ethers.constants.AddressZero);
        });
      });
      describe("factory management", function () {
        it("should create vaults correctly", async function () {
          const deployer = ethers.constants.AddressZero;
          await FlypeMaxiFactory.deployVault(
            token0.address,
            token1.address,
            3000,
            deployer,
            0,
            -887220,
            887220
          );
          let deployerVaults = await FlypeMaxiFactory.getVaults(deployer);
          /* @ts-ignore */
          let newVault = (await ethers.getContractAt(
            "FlypeMaxiVaultV1",
            deployerVaults[deployerVaults.length - 1]
          )) as FlypeMaxiVaultV1;

          let newVaultManager = await newVault.manager();
          expect(newVaultManager).to.equal(ethers.constants.AddressZero);
          await uniswapFactory.createPool(
            token0.address,
            token1.address,
            "500"
          );
          await FlypeMaxiFactory.deployVault(
            token0.address,
            token1.address,
            500,
            ethers.constants.AddressZero,
            0,
            -10,
            10
          );
          deployerVaults = await FlypeMaxiFactory.getVaults(deployer);
          /* @ts-ignore */
          newVault = (await ethers.getContractAt(
            "FlypeMaxiVaultV1",
            deployerVaults[deployerVaults.length - 1]
          )) as FlypeMaxiVaultV1;
          newVaultManager = await newVault.manager();
          expect(newVaultManager).to.equal(ethers.constants.AddressZero);
          let lowerTick = await newVault.lowerTick();
          let upperTick = await newVault.upperTick();
          expect(lowerTick).to.equal(-10);
          expect(upperTick).to.equal(10);

          await uniswapFactory.createPool(
            token0.address,
            token1.address,
            "10000"
          );
          await FlypeMaxiFactory.deployVault(
            token0.address,
            token1.address,
            10000,
            ethers.constants.AddressZero,
            0,
            200,
            600
          );
          deployerVaults = await FlypeMaxiFactory.getVaults(deployer);
          /* @ts-ignore */
          newVault = (await ethers.getContractAt(
            "FlypeMaxiVaultV1",
            deployerVaults[deployerVaults.length - 1]
          )) as FlypeMaxiVaultV1;
          newVaultManager = await newVault.manager();
          expect(newVaultManager).to.equal(ethers.constants.AddressZero);
          lowerTick = await newVault.lowerTick();
          upperTick = await newVault.upperTick();
          expect(lowerTick).to.equal(200);
          expect(upperTick).to.equal(600);

          await expect(
            FlypeMaxiFactory.deployVault(
              token0.address,
              token1.address,
              3000,
              ethers.constants.AddressZero,
              0,
              -10,
              10
            )
          ).to.be.reverted;
          await expect(
            FlypeMaxiFactory.deployVault(
              token0.address,
              token1.address,
              10000,
              ethers.constants.AddressZero,
              0,
              -10,
              10
            )
          ).to.be.reverted;
          await expect(
            FlypeMaxiFactory.deployVault(
              token0.address,
              token1.address,
              500,
              ethers.constants.AddressZero,
              0,
              -5,
              5
            )
          ).to.be.reverted;
          await expect(
            FlypeMaxiFactory.deployVault(
              token0.address,
              token1.address,
              500,
              ethers.constants.AddressZero,
              0,
              100,
              0
            )
          ).to.be.reverted;
        });

        it("should handle implementation upgrades and whitelisting", async function () {
          const manager = await FlypeMaxiFactory.manager();
          expect(manager).to.equal(await user0.getAddress());

          // only manager should be able to call permissioned functions
          await expect(
            FlypeMaxiFactory.connect(REBALANCER).upgradeVaults([vault.address])
          ).to.be.reverted;
          await expect(
            FlypeMaxiFactory.connect(REBALANCER).upgradeVaultsAndCall(
              [vault.address],
              ["0x"]
            )
          ).to.be.reverted;
          await expect(
            FlypeMaxiFactory.connect(REBALANCER).makeVaultsImmutable([
              vault.address,
            ])
          ).to.be.reverted;
          await expect(
            FlypeMaxiFactory.connect(REBALANCER).setvaultImplementation(
              ethers.constants.AddressZero
            )
          ).to.be.reverted;

          const implementationBefore =
            await FlypeMaxiFactory.vaultImplementation();
          expect(implementationBefore).to.equal(implementationAddress);
          await FlypeMaxiFactory.setvaultImplementation(
            ethers.constants.AddressZero
          );
          const implementationAfter =
            await FlypeMaxiFactory.vaultImplementation();
          expect(implementationAfter).to.equal(ethers.constants.AddressZero);
          await FlypeMaxiFactory.upgradeVaults([vault.address]);
          await expect(vault.totalSupply()).to.be.reverted;
          const proxyAdmin = await FlypeMaxiFactory.getProxyAdmin(
            vault.address
          );
          expect(proxyAdmin).to.equal(FlypeMaxiFactory.address);
          const isNotImmutable = await FlypeMaxiFactory.isVaultImmutable(
            vault.address
          );
          expect(isNotImmutable).to.be.false;
          await FlypeMaxiFactory.makeVaultsImmutable([vault.address]);
          await expect(FlypeMaxiFactory.upgradeVaults([vault.address])).to.be
            .reverted;
          /* @ts-ignore */
          const vaultProxy = (await ethers.getContractAt(
            "EIP173Proxy",
            vault.address
          )) as EIP173Proxy;
          await expect(
            vaultProxy.connect(user0).upgradeTo(implementationAddress)
          ).to.be.reverted;
          const isImmutable = await FlypeMaxiFactory.isVaultImmutable(
            vault.address
          );
          expect(isImmutable).to.be.true;
          await FlypeMaxiFactory.transferOwnership(await user1.getAddress());
          const manager2 = await FlypeMaxiFactory.manager();
          expect(manager2).to.equal(await user1.getAddress());
          await FlypeMaxiFactory.connect(user1).renounceOwnership();
          const manager3 = await FlypeMaxiFactory.manager();
          expect(manager3).to.equal(ethers.constants.AddressZero);
        });
      });
    });
  });
});
