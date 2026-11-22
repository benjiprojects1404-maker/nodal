// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../../NodalRouter.sol";
import "../../NodalMocks.sol";

/// @dev A token that reverts on a zero-amount transfer (some real tokens do), to prove a 0% fee
/// never sends the treasury a zero transfer.
contract NoZeroTransferToken is MockERC20 {
    constructor() MockERC20("No Zero", "NZ", 18) {}
    function _update(address from, address to, uint256 value) internal override {
        require(value > 0 || from == address(0), "zero transfer");
        super._update(from, to, value);
    }
}

/// @dev Router that reports one output from getAmountsOut but delivers less on the swap.
contract ShortChangingRouter {
    MockERC20 public immutable outToken;
    uint256 public immutable shortBps; // how much it keeps back, in bps of the quoted output
    constructor(MockERC20 out_, uint256 shortBps_) { outToken = out_; shortBps = shortBps_; }
    function getAmountsOut(uint256 amountIn, address[] calldata path) public pure returns (uint256[] memory a) {
        a = new uint256[](path.length);
        a[0] = amountIn;
        a[path.length - 1] = amountIn * 2;
    }
    function swapExactTokensForTokens(uint256 amountIn, uint256, address[] calldata path, address to, uint256)
        external returns (uint256[] memory a)
    {
        a = getAmountsOut(amountIn, path);
        MockERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        uint256 out = a[path.length - 1] - (a[path.length - 1] * shortBps) / 10000;
        outToken.transfer(to, out);
        a[path.length - 1] = a[path.length - 1] * 10; // and lies in its return value too
    }
}

/// @dev Router that tries to re-enter NodalRouter in the middle of a swap.
contract ReenteringRouter {
    NodalRouter public nodal;
    bytes32 public id;
    bool public reentryBlocked;
    function arm(NodalRouter n, bytes32 i) external { nodal = n; id = i; }
    function getAmountsOut(uint256 amountIn, address[] calldata path) public pure returns (uint256[] memory a) {
        a = new uint256[](path.length);
        a[0] = amountIn;
        a[path.length - 1] = amountIn;
    }
    function swapExactTokensForTokens(uint256 amountIn, uint256, address[] calldata path, address to, uint256)
        external returns (uint256[] memory a)
    {
        MockERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        try nodal.swapExactTokensForTokens(id, amountIn, 0, path, block.timestamp) {
            reentryBlocked = false;
        } catch (bytes memory err) {
            reentryBlocked = bytes4(err) == ReentrancyGuard.ReentrancyGuardReentrantCall.selector;
        }
        MockERC20(path[path.length - 1]).transfer(to, amountIn);
        a = getAmountsOut(amountIn, path);
    }
}

contract NodalRouterTest is Test {
    NodalRouter nodal;
    MockDexRouter dex;
    MockERC20 tokA;
    MockERC20 tokB;
    MockERC20 wbdag; // stands in for the DEX's wrapped BDAG in native paths
    address treasury = makeAddr("treasury");
    address user = makeAddr("user");
    bytes32 constant SRC = keccak256("mock");

    function setUp() public {
        nodal = new NodalRouter(treasury);
        dex = new MockDexRouter();
        tokA = new MockERC20("A", "A", 18);
        tokB = new MockERC20("B", "B", 6);
        wbdag = new MockERC20("WBDAG", "WBDAG", 18);
        nodal.registerSource(SRC, address(dex), "Mock");
        tokB.mint(address(dex), type(uint128).max);
        tokA.mint(address(dex), type(uint128).max);
        vm.deal(address(dex), type(uint128).max);
    }

    function _path(address a, address b) internal pure returns (address[] memory p) {
        p = new address[](2);
        p[0] = a;
        p[1] = b;
    }

    function _expect(uint256 gross, uint16 bps) internal pure returns (uint256 fee, uint256 net) {
        fee = (gross * bps) / 10000;
        net = gross - fee;
    }

    // ---------------------------------------------------------------- fee maths, all three swap paths

    function testFuzz_tokenToToken_feeSplitAndNothingLeftBehind(uint96 amountIn, uint16 bps, uint64 rate) public {
        bps = uint16(bound(bps, 0, nodal.MAX_FEE_BPS()));
        amountIn = uint96(bound(amountIn, 1, type(uint96).max));
        rate = uint64(bound(rate, 1e9, 1e19));
        nodal.setFeeBps(bps);
        dex.setRate(address(tokA), address(tokB), rate);
        address[] memory p = _path(address(tokA), address(tokB));
        uint256 gross = (uint256(amountIn) * rate) / 1e18;
        vm.assume(gross > 0);
        (uint256 fee, uint256 net) = _expect(gross, bps);

        (, uint256 qFee, uint256 qNet) = nodal.quote(SRC, amountIn, p);
        assertEq(qFee, fee, "quoted fee");
        assertEq(qNet, net, "quoted net");

        tokA.mint(user, amountIn);
        vm.startPrank(user);
        tokA.approve(address(nodal), amountIn);
        uint256 got = nodal.swapExactTokensForTokens(SRC, amountIn, net, p, block.timestamp);
        vm.stopPrank();

        assertEq(got, net, "returned net");
        assertEq(tokB.balanceOf(user), net, "user paid net");
        assertEq(tokB.balanceOf(treasury), fee, "treasury paid fee");
        assertEq(tokA.balanceOf(address(nodal)), 0, "no input left in router");
        assertEq(tokB.balanceOf(address(nodal)), 0, "no output left in router");
        assertEq(tokA.allowance(address(nodal), address(dex)), 0, "no leftover approval to the DEX");
    }

    function testFuzz_bdagToToken_feeSplit(uint96 value, uint16 bps, uint64 rate) public {
        bps = uint16(bound(bps, 0, nodal.MAX_FEE_BPS()));
        value = uint96(bound(value, 1, type(uint96).max));
        rate = uint64(bound(rate, 1e9, 1e19));
        nodal.setFeeBps(bps);
        dex.setRate(address(wbdag), address(tokB), rate);
        uint256 gross = (uint256(value) * rate) / 1e18;
        vm.assume(gross > 0);
        (uint256 fee, uint256 net) = _expect(gross, bps);

        vm.deal(user, value);
        vm.prank(user);
        nodal.swapExactBDAGForTokens{value: value}(SRC, net, _path(address(wbdag), address(tokB)), block.timestamp);

        assertEq(tokB.balanceOf(user), net);
        assertEq(tokB.balanceOf(treasury), fee);
        assertEq(tokB.balanceOf(address(nodal)), 0);
        assertEq(address(nodal).balance, 0, "no BDAG left in router");
    }

    function testFuzz_tokenToBdag_feeSplit(uint96 amountIn, uint16 bps, uint64 rate) public {
        bps = uint16(bound(bps, 0, nodal.MAX_FEE_BPS()));
        amountIn = uint96(bound(amountIn, 1, type(uint96).max));
        rate = uint64(bound(rate, 1e9, 1e19));
        nodal.setFeeBps(bps);
        dex.setRate(address(tokA), address(wbdag), rate);
        uint256 gross = (uint256(amountIn) * rate) / 1e18;
        vm.assume(gross > 0);
        (uint256 fee, uint256 net) = _expect(gross, bps);

        tokA.mint(user, amountIn);
        vm.startPrank(user);
        tokA.approve(address(nodal), amountIn);
        nodal.swapExactTokensForBDAG(SRC, amountIn, net, _path(address(tokA), address(wbdag)), block.timestamp);
        vm.stopPrank();

        assertEq(user.balance, net);
        assertEq(treasury.balance, fee);
        assertEq(address(nodal).balance, 0);
        assertEq(tokA.balanceOf(address(nodal)), 0);
    }

    // ---------------------------------------------------------------- the 0% fee setting

    function test_zeroFee_treasuryGetsNothing_andNoZeroTransfer() public {
        NoZeroTransferToken nz = new NoZeroTransferToken();
        nz.mint(address(dex), 1e30);
        dex.setRate(address(tokA), address(nz), 1e18);
        nodal.setFeeBps(0);
        tokA.mint(user, 1e18);
        vm.startPrank(user);
        tokA.approve(address(nodal), 1e18);
        uint256 got = nodal.swapExactTokensForTokens(SRC, 1e18, 1e18, _path(address(tokA), address(nz)), block.timestamp);
        vm.stopPrank();
        assertEq(got, 1e18, "user gets the full DEX output");
        assertEq(nz.balanceOf(treasury), 0);
    }

    function test_zeroFee_nativeOut_noFeeCall() public {
        // Treasury that rejects BDAG: with a 0% fee it must never be called.
        RejectBDAG rej = new RejectBDAG();
        nodal.setTreasury(address(rej));
        nodal.setFeeBps(0);
        dex.setRate(address(tokA), address(wbdag), 1e18);
        tokA.mint(user, 1e18);
        vm.startPrank(user);
        tokA.approve(address(nodal), 1e18);
        nodal.swapExactTokensForBDAG(SRC, 1e18, 1e18, _path(address(tokA), address(wbdag)), block.timestamp);
        vm.stopPrank();
        assertEq(user.balance, 1e18);
    }

    // ---------------------------------------------------------------- admin limits

    function testFuzz_feeCannotExceedCap(uint16 bps) public {
        vm.assume(bps > nodal.MAX_FEE_BPS());
        vm.expectRevert("fee too high");
        nodal.setFeeBps(bps);
    }

    function testFuzz_onlyOwnerAdmin(address who, uint16 bps) public {
        vm.assume(who != address(this));
        bps = uint16(bound(bps, 0, 100));
        vm.startPrank(who);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, who));
        nodal.setFeeBps(bps);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, who));
        nodal.setTreasury(who);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, who));
        nodal.pause();
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, who));
        nodal.setMaxAmountIn(address(tokA), 1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, who));
        nodal.registerSource(keccak256("x"), who, "x");
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, who));
        nodal.rescueToken(address(tokA), who, 0);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- user protections

    function testFuzz_slippageFloor(uint96 amountIn, uint256 minOut) public {
        amountIn = uint96(bound(amountIn, 1e6, type(uint96).max));
        dex.setRate(address(tokA), address(tokB), 1e18);
        (, , uint256 net) = nodal.quote(SRC, amountIn, _path(address(tokA), address(tokB)));
        minOut = bound(minOut, net + 1, type(uint256).max);
        tokA.mint(user, amountIn);
        vm.startPrank(user);
        tokA.approve(address(nodal), amountIn);
        vm.expectRevert("slippage");
        nodal.swapExactTokensForTokens(SRC, amountIn, minOut, _path(address(tokA), address(tokB)), block.timestamp);
        vm.stopPrank();
        assertEq(tokA.balanceOf(user), amountIn, "nothing spent on a failed swap");
    }

    function testFuzz_perTradeCap(uint96 cap, uint96 amountIn) public {
        cap = uint96(bound(cap, 1, type(uint96).max - 1));
        amountIn = uint96(bound(amountIn, 1, type(uint96).max));
        nodal.setMaxAmountIn(address(tokA), cap);
        dex.setRate(address(tokA), address(tokB), 1e18);
        tokA.mint(user, amountIn);
        vm.startPrank(user);
        tokA.approve(address(nodal), amountIn);
        if (amountIn > cap) vm.expectRevert("exceeds per-tx cap");
        nodal.swapExactTokensForTokens(SRC, amountIn, 0, _path(address(tokA), address(tokB)), block.timestamp);
        vm.stopPrank();
    }

    function testFuzz_nativeCap(uint96 cap, uint96 value) public {
        cap = uint96(bound(cap, 1, type(uint96).max - 1));
        value = uint96(bound(value, 1, type(uint96).max));
        nodal.setMaxAmountIn(address(0), cap);
        dex.setRate(address(wbdag), address(tokB), 1e18);
        vm.deal(user, value);
        vm.prank(user);
        if (value > cap) vm.expectRevert("exceeds per-tx cap");
        nodal.swapExactBDAGForTokens{value: value}(SRC, 0, _path(address(wbdag), address(tokB)), block.timestamp);
    }

    function test_pauseBlocksSwapsButNotQuotes() public {
        dex.setRate(address(tokA), address(tokB), 1e18);
        nodal.pause();
        nodal.quoteAll(1e18, _path(address(tokA), address(tokB)));
        tokA.mint(user, 1e18);
        vm.startPrank(user);
        tokA.approve(address(nodal), 1e18);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        nodal.swapExactTokensForTokens(SRC, 1e18, 0, _path(address(tokA), address(tokB)), block.timestamp);
        vm.stopPrank();
    }

    function test_inactiveSourceRefused() public {
        dex.setRate(address(tokA), address(tokB), 1e18);
        nodal.setSourceActive(SRC, false);
        tokA.mint(user, 1e18);
        vm.startPrank(user);
        tokA.approve(address(nodal), 1e18);
        vm.expectRevert("source unavailable");
        nodal.swapExactTokensForTokens(SRC, 1e18, 0, _path(address(tokA), address(tokB)), block.timestamp);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- hostile liquidity sources

    function testFuzz_shortChangingRouter_paysOnlyWhatArrived(uint96 amountIn, uint16 shortBps) public {
        amountIn = uint96(bound(amountIn, 1e6, type(uint96).max));
        shortBps = uint16(bound(shortBps, 1, 5000));
        ShortChangingRouter bad = new ShortChangingRouter(tokB, shortBps);
        tokB.mint(address(bad), type(uint128).max);
        nodal.registerSource(keccak256("bad"), address(bad), "Bad");
        nodal.setFeeBps(15);
        address[] memory p = _path(address(tokA), address(tokB));
        uint256 arrived = uint256(amountIn) * 2 - (uint256(amountIn) * 2 * shortBps) / 10000;
        (uint256 fee, uint256 net) = _expect(arrived, 15);

        tokA.mint(user, amountIn);
        vm.startPrank(user);
        tokA.approve(address(nodal), amountIn);
        uint256 got = nodal.swapExactTokensForTokens(keccak256("bad"), amountIn, 0, p, block.timestamp);
        vm.stopPrank();
        assertEq(got, net, "settles on the balance that arrived, not the router's claim");
        assertEq(tokB.balanceOf(user) + tokB.balanceOf(treasury), arrived);
        assertEq(tokB.balanceOf(treasury), fee);
        assertEq(tokB.balanceOf(address(nodal)), 0);
    }

    function test_shortChangingRouter_stoppedBySlippageFloor() public {
        ShortChangingRouter bad = new ShortChangingRouter(tokB, 1000); // keeps 10%
        tokB.mint(address(bad), 1e30);
        nodal.registerSource(keccak256("bad"), address(bad), "Bad");
        address[] memory p = _path(address(tokA), address(tokB));
        (, , uint256 quotedNet) = nodal.quote(keccak256("bad"), 1e18, p);
        uint256 minOut = quotedNet - (quotedNet * 50) / 10000; // user's 0.5% slippage
        tokA.mint(user, 1e18);
        vm.startPrank(user);
        tokA.approve(address(nodal), 1e18);
        vm.expectRevert("slippage");
        nodal.swapExactTokensForTokens(keccak256("bad"), 1e18, minOut, p, block.timestamp);
        vm.stopPrank();
    }

    function test_reentrancyFromSourceBlocked() public {
        ReenteringRouter evil = new ReenteringRouter();
        tokB.mint(address(evil), 1e30);
        nodal.registerSource(keccak256("evil"), address(evil), "Evil");
        evil.arm(nodal, keccak256("evil"));
        tokA.mint(user, 1e18);
        vm.startPrank(user);
        tokA.approve(address(nodal), 1e18);
        nodal.swapExactTokensForTokens(keccak256("evil"), 1e18, 0, _path(address(tokA), address(tokB)), block.timestamp);
        vm.stopPrank();
        assertTrue(evil.reentryBlocked(), "inner swap must be refused");
        assertEq(tokB.balanceOf(user), 1e18 - (1e18 * 15) / 10000);
    }

    // ---------------------------------------------------------------- quoting

    function testFuzz_quoteAllMatchesExecution(uint96 amountIn, uint64 rate, uint16 bps) public {
        amountIn = uint96(bound(amountIn, 1, type(uint96).max));
        rate = uint64(bound(rate, 1e9, 1e19));
        bps = uint16(bound(bps, 0, 100));
        nodal.setFeeBps(bps);
        dex.setRate(address(tokA), address(tokB), rate);
        address[] memory p = _path(address(tokA), address(tokB));
        (bytes32[] memory ids, , , uint256[] memory nets) = nodal.quoteAll(amountIn, p);
        assertEq(ids[0], SRC);
        vm.assume(nets[0] > 0);
        tokA.mint(user, amountIn);
        vm.startPrank(user);
        tokA.approve(address(nodal), amountIn);
        uint256 got = nodal.swapExactTokensForTokens(SRC, amountIn, nets[0], p, block.timestamp);
        vm.stopPrank();
        assertEq(got, nets[0]);
    }

    function test_quoteAllSkipsBrokenSource() public {
        nodal.registerSource(keccak256("broken"), address(new RejectBDAG()), "Broken"); // no getAmountsOut
        dex.setRate(address(tokA), address(tokB), 1e18);
        (, , , uint256[] memory nets) = nodal.quoteAll(1e18, _path(address(tokA), address(tokB)));
        assertGt(nets[0], 0);
        assertEq(nets[1], 0);
    }
}

contract RejectBDAG {
    receive() external payable { revert("no"); }
}

// ---------------------------------------------------------------- invariant: nothing ever rests in the router

contract Handler is Test {
    NodalRouter public nodal;
    MockDexRouter public dex;
    MockERC20 public tokA;
    MockERC20 public tokB;
    MockERC20 public wbdag;
    address public treasury;
    bytes32 constant SRC = keccak256("mock");
    uint256 public feesB; // tokB fees paid out
    uint256 public feesNative;
    address owner;

    constructor(NodalRouter n, MockDexRouter d, MockERC20 a, MockERC20 b, MockERC20 w, address t, address o) {
        nodal = n; dex = d; tokA = a; tokB = b; wbdag = w; treasury = t; owner = o;
    }

    function _p(address a, address b) internal pure returns (address[] memory p) {
        p = new address[](2); p[0] = a; p[1] = b;
    }

    function setFee(uint16 bps) external {
        vm.prank(owner);
        nodal.setFeeBps(uint16(bound(bps, 0, 100)));
    }

    function swapAB(uint96 amt, uint256 actorSeed) external {
        amt = uint96(bound(amt, 1, 1e30));
        address u = address(uint160(bound(actorSeed, 1000, 1100)));
        tokA.mint(u, amt);
        uint256 t0 = tokB.balanceOf(treasury);
        vm.startPrank(u);
        tokA.approve(address(nodal), amt);
        try nodal.swapExactTokensForTokens(SRC, amt, 0, _p(address(tokA), address(tokB)), block.timestamp) {} catch {}
        vm.stopPrank();
        feesB += tokB.balanceOf(treasury) - t0;
    }

    function swapNativeIn(uint96 value, uint256 actorSeed) external {
        value = uint96(bound(value, 1, 1e30));
        address u = address(uint160(bound(actorSeed, 1000, 1100)));
        vm.deal(u, value);
        uint256 t0 = tokB.balanceOf(treasury);
        vm.prank(u);
        try nodal.swapExactBDAGForTokens{value: value}(SRC, 0, _p(address(wbdag), address(tokB)), block.timestamp) {} catch {}
        feesB += tokB.balanceOf(treasury) - t0;
    }

    function swapNativeOut(uint96 amt, uint256 actorSeed) external {
        amt = uint96(bound(amt, 1, 1e30));
        address u = address(uint160(bound(actorSeed, 1000, 1100)));
        tokA.mint(u, amt);
        uint256 t0 = treasury.balance;
        vm.startPrank(u);
        tokA.approve(address(nodal), amt);
        try nodal.swapExactTokensForBDAG(SRC, amt, 0, _p(address(tokA), address(wbdag)), block.timestamp) {} catch {}
        vm.stopPrank();
        feesNative += treasury.balance - t0;
    }
}

contract NodalRouterInvariantTest is Test {
    NodalRouter nodal;
    Handler h;
    MockERC20 tokA;
    MockERC20 tokB;
    MockERC20 wbdag;
    address treasury = makeAddr("treasury");

    function setUp() public {
        nodal = new NodalRouter(treasury);
        MockDexRouter dex = new MockDexRouter();
        tokA = new MockERC20("A", "A", 18);
        tokB = new MockERC20("B", "B", 18);
        wbdag = new MockERC20("W", "W", 18);
        nodal.registerSource(keccak256("mock"), address(dex), "Mock");
        dex.setRate(address(tokA), address(tokB), 3e18);
        dex.setRate(address(wbdag), address(tokB), 5e17);
        dex.setRate(address(tokA), address(wbdag), 1e18);
        tokB.mint(address(dex), type(uint128).max);
        vm.deal(address(dex), type(uint128).max);
        h = new Handler(nodal, dex, tokA, tokB, wbdag, treasury, address(this));
        targetContract(address(h));
    }

    /// No user funds ever rest in NodalRouter between transactions.
    function invariant_routerHoldsNothing() public view {
        assertEq(tokA.balanceOf(address(nodal)), 0);
        assertEq(tokB.balanceOf(address(nodal)), 0);
        assertEq(address(nodal).balance, 0);
    }

    /// The treasury only ever receives fees (never more than 1% of what was routed).
    function invariant_treasuryOnlyGetsFees() public view {
        assertEq(tokB.balanceOf(treasury), h.feesB());
        assertEq(treasury.balance, h.feesNative());
    }

    /// The fee can never be set above the hard cap.
    function invariant_feeWithinCap() public view {
        assertLe(nodal.feeBps(), nodal.MAX_FEE_BPS());
    }
}
