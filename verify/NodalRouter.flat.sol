// SPDX-License-Identifier: MIT
// File: @openzeppelin/contracts@5.0.2/utils/Context.sol
// OpenZeppelin Contracts (last updated v5.0.1) (utils/Context.sol)

pragma solidity ^0.8.20;

/**
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }

    function _contextSuffixLength() internal view virtual returns (uint256) {
        return 0;
    }
}

// File: @openzeppelin/contracts@5.0.2/access/Ownable.sol
// OpenZeppelin Contracts (last updated v5.0.0) (access/Ownable.sol)

pragma solidity ^0.8.20;


/**
 * @dev Contract module which provides a basic access control mechanism, where
 * there is an account (an owner) that can be granted exclusive access to
 * specific functions.
 *
 * The initial owner is set to the address provided by the deployer. This can
 * later be changed with {transferOwnership}.
 *
 * This module is used through inheritance. It will make available the modifier
 * `onlyOwner`, which can be applied to your functions to restrict their use to
 * the owner.
 */
abstract contract Ownable is Context {
    address private _owner;

    /**
     * @dev The caller account is not authorized to perform an operation.
     */
    error OwnableUnauthorizedAccount(address account);

    /**
     * @dev The owner is not a valid owner account. (eg. `address(0)`)
     */
    error OwnableInvalidOwner(address owner);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /**
     * @dev Initializes the contract setting the address provided by the deployer as the initial owner.
     */
    constructor(address initialOwner) {
        if (initialOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(initialOwner);
    }

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() public view virtual returns (address) {
        return _owner;
    }

    /**
     * @dev Throws if the sender is not the owner.
     */
    function _checkOwner() internal view virtual {
        if (owner() != _msgSender()) {
            revert OwnableUnauthorizedAccount(_msgSender());
        }
    }

    /**
     * @dev Leaves the contract without owner. It will not be possible to call
     * `onlyOwner` functions. Can only be called by the current owner.
     *
     * NOTE: Renouncing ownership will leave the contract without an owner,
     * thereby disabling any functionality that is only available to the owner.
     */
    function renounceOwnership() public virtual onlyOwner {
        _transferOwnership(address(0));
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) public virtual onlyOwner {
        if (newOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(newOwner);
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Internal function without access restriction.
     */
    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}

// File: @openzeppelin/contracts@5.0.2/utils/ReentrancyGuard.sol
// OpenZeppelin Contracts (last updated v5.0.0) (utils/ReentrancyGuard.sol)

pragma solidity ^0.8.20;

/**
 * @dev Contract module that helps prevent reentrant calls to a function.
 *
 * Inheriting from `ReentrancyGuard` will make the {nonReentrant} modifier
 * available, which can be applied to functions to make sure there are no nested
 * (reentrant) calls to them.
 *
 * Note that because there is a single `nonReentrant` guard, functions marked as
 * `nonReentrant` may not call one another. This can be worked around by making
 * those functions `private`, and then adding `external` `nonReentrant` entry
 * points to them.
 *
 * TIP: If you would like to learn more about reentrancy and alternative ways
 * to protect against it, check out our blog post
 * https://blog.openzeppelin.com/reentrancy-after-istanbul/[Reentrancy After Istanbul].
 */
abstract contract ReentrancyGuard {
    // Booleans are more expensive than uint256 or any type that takes up a full
    // word because each write operation emits an extra SLOAD to first read the
    // slot's contents, replace the bits taken up by the boolean, and then write
    // back. This is the compiler's defense against contract upgrades and
    // pointer aliasing, and it cannot be disabled.

    // The values being non-zero value makes deployment a bit more expensive,
    // but in exchange the refund on every call to nonReentrant will be lower in
    // amount. Since refunds are capped to a percentage of the total
    // transaction's gas, it is best to keep them low in cases like this one, to
    // increase the likelihood of the full refund coming into effect.
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    uint256 private _status;

    /**
     * @dev Unauthorized reentrant call.
     */
    error ReentrancyGuardReentrantCall();

    constructor() {
        _status = NOT_ENTERED;
    }

    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     * Calling a `nonReentrant` function from another `nonReentrant`
     * function is not supported. It is possible to prevent this from happening
     * by making the `nonReentrant` function external, and making it call a
     * `private` function that does the actual work.
     */
    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _nonReentrantBefore() private {
        // On the first call to nonReentrant, _status will be NOT_ENTERED
        if (_status == ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }

        // Any calls to nonReentrant after this point will fail
        _status = ENTERED;
    }

    function _nonReentrantAfter() private {
        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        _status = NOT_ENTERED;
    }

    /**
     * @dev Returns true if the reentrancy guard is currently set to "entered", which indicates there is a
     * `nonReentrant` function in the call stack.
     */
    function _reentrancyGuardEntered() internal view returns (bool) {
        return _status == ENTERED;
    }
}

// File: @openzeppelin/contracts@5.0.2/utils/Pausable.sol
// OpenZeppelin Contracts (last updated v5.0.0) (utils/Pausable.sol)

pragma solidity ^0.8.20;


/**
 * @dev Contract module which allows children to implement an emergency stop
 * mechanism that can be triggered by an authorized account.
 *
 * This module is used through inheritance. It will make available the
 * modifiers `whenNotPaused` and `whenPaused`, which can be applied to
 * the functions of your contract. Note that they will not be pausable by
 * simply including this module, only once the modifiers are put in place.
 */
abstract contract Pausable is Context {
    bool private _paused;

    /**
     * @dev Emitted when the pause is triggered by `account`.
     */
    event Paused(address account);

    /**
     * @dev Emitted when the pause is lifted by `account`.
     */
    event Unpaused(address account);

    /**
     * @dev The operation failed because the contract is paused.
     */
    error EnforcedPause();

    /**
     * @dev The operation failed because the contract is not paused.
     */
    error ExpectedPause();

    /**
     * @dev Initializes the contract in unpaused state.
     */
    constructor() {
        _paused = false;
    }

    /**
     * @dev Modifier to make a function callable only when the contract is not paused.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    modifier whenNotPaused() {
        _requireNotPaused();
        _;
    }

    /**
     * @dev Modifier to make a function callable only when the contract is paused.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    modifier whenPaused() {
        _requirePaused();
        _;
    }

    /**
     * @dev Returns true if the contract is paused, and false otherwise.
     */
    function paused() public view virtual returns (bool) {
        return _paused;
    }

    /**
     * @dev Throws if the contract is paused.
     */
    function _requireNotPaused() internal view virtual {
        if (paused()) {
            revert EnforcedPause();
        }
    }

    /**
     * @dev Throws if the contract is not paused.
     */
    function _requirePaused() internal view virtual {
        if (!paused()) {
            revert ExpectedPause();
        }
    }

    /**
     * @dev Triggers stopped state.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    function _pause() internal virtual whenNotPaused {
        _paused = true;
        emit Paused(_msgSender());
    }

    /**
     * @dev Returns to normal state.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    function _unpause() internal virtual whenPaused {
        _paused = false;
        emit Unpaused(_msgSender());
    }
}

// File: @openzeppelin/contracts@5.0.2/token/ERC20/IERC20.sol
// OpenZeppelin Contracts (last updated v5.0.0) (token/ERC20/IERC20.sol)

pragma solidity ^0.8.20;

/**
 * @dev Interface of the ERC20 standard as defined in the EIP.
 */
interface IERC20 {
    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when the allowance of a `spender` for an `owner` is set by
     * a call to {approve}. `value` is the new allowance.
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /**
     * @dev Returns the value of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the value of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address to, uint256 value) external returns (bool);

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the
     * allowance mechanism. `value` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

// File: @openzeppelin/contracts@5.0.2/token/ERC20/extensions/IERC20Permit.sol
// OpenZeppelin Contracts (last updated v5.0.0) (token/ERC20/extensions/IERC20Permit.sol)

pragma solidity ^0.8.20;

/**
 * @dev Interface of the ERC20 Permit extension allowing approvals to be made via signatures, as defined in
 * https://eips.ethereum.org/EIPS/eip-2612[EIP-2612].
 *
 * Adds the {permit} method, which can be used to change an account's ERC20 allowance (see {IERC20-allowance}) by
 * presenting a message signed by the account. By not relying on {IERC20-approve}, the token holder account doesn't
 * need to send a transaction, and thus is not required to hold Ether at all.
 *
 * ==== Security Considerations
 *
 * There are two important considerations concerning the use of `permit`. The first is that a valid permit signature
 * expresses an allowance, and it should not be assumed to convey additional meaning. In particular, it should not be
 * considered as an intention to spend the allowance in any specific way. The second is that because permits have
 * built-in replay protection and can be submitted by anyone, they can be frontrun. A protocol that uses permits should
 * take this into consideration and allow a `permit` call to fail. Combining these two aspects, a pattern that may be
 * generally recommended is:
 *
 * ```solidity
 * function doThingWithPermit(..., uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) public {
 *     try token.permit(msg.sender, address(this), value, deadline, v, r, s) {} catch {}
 *     doThing(..., value);
 * }
 *
 * function doThing(..., uint256 value) public {
 *     token.safeTransferFrom(msg.sender, address(this), value);
 *     ...
 * }
 * ```
 *
 * Observe that: 1) `msg.sender` is used as the owner, leaving no ambiguity as to the signer intent, and 2) the use of
 * `try/catch` allows the permit to fail and makes the code tolerant to frontrunning. (See also
 * {SafeERC20-safeTransferFrom}).
 *
 * Additionally, note that smart contract wallets (such as Argent or Safe) are not able to produce permit signatures, so
 * contracts should have entry points that don't rely on permit.
 */
interface IERC20Permit {
    /**
     * @dev Sets `value` as the allowance of `spender` over ``owner``'s tokens,
     * given ``owner``'s signed approval.
     *
     * IMPORTANT: The same issues {IERC20-approve} has related to transaction
     * ordering also apply here.
     *
     * Emits an {Approval} event.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     * - `deadline` must be a timestamp in the future.
     * - `v`, `r` and `s` must be a valid `secp256k1` signature from `owner`
     * over the EIP712-formatted function arguments.
     * - the signature must use ``owner``'s current nonce (see {nonces}).
     *
     * For more information on the signature format, see the
     * https://eips.ethereum.org/EIPS/eip-2612#specification[relevant EIP
     * section].
     *
     * CAUTION: See Security Considerations above.
     */
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    /**
     * @dev Returns the current nonce for `owner`. This value must be
     * included whenever a signature is generated for {permit}.
     *
     * Every successful call to {permit} increases ``owner``'s nonce by one. This
     * prevents a signature from being used multiple times.
     */
    function nonces(address owner) external view returns (uint256);

    /**
     * @dev Returns the domain separator used in the encoding of the signature for {permit}, as defined by {EIP712}.
     */
    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

// File: @openzeppelin/contracts@5.0.2/utils/Address.sol
// OpenZeppelin Contracts (last updated v5.0.0) (utils/Address.sol)

pragma solidity ^0.8.20;

/**
 * @dev Collection of functions related to the address type
 */
library Address {
    /**
     * @dev The ETH balance of the account is not enough to perform the operation.
     */
    error AddressInsufficientBalance(address account);

    /**
     * @dev There's no code at `target` (it is not a contract).
     */
    error AddressEmptyCode(address target);

    /**
     * @dev A call to an address target failed. The target may have reverted.
     */
    error FailedInnerCall();

    /**
     * @dev Replacement for Solidity's `transfer`: sends `amount` wei to
     * `recipient`, forwarding all available gas and reverting on errors.
     *
     * https://eips.ethereum.org/EIPS/eip-1884[EIP1884] increases the gas cost
     * of certain opcodes, possibly making contracts go over the 2300 gas limit
     * imposed by `transfer`, making them unable to receive funds via
     * `transfer`. {sendValue} removes this limitation.
     *
     * https://consensys.net/diligence/blog/2019/09/stop-using-soliditys-transfer-now/[Learn more].
     *
     * IMPORTANT: because control is transferred to `recipient`, care must be
     * taken to not create reentrancy vulnerabilities. Consider using
     * {ReentrancyGuard} or the
     * https://solidity.readthedocs.io/en/v0.8.20/security-considerations.html#use-the-checks-effects-interactions-pattern[checks-effects-interactions pattern].
     */
    function sendValue(address payable recipient, uint256 amount) internal {
        if (address(this).balance < amount) {
            revert AddressInsufficientBalance(address(this));
        }

        (bool success, ) = recipient.call{value: amount}("");
        if (!success) {
            revert FailedInnerCall();
        }
    }

    /**
     * @dev Performs a Solidity function call using a low level `call`. A
     * plain `call` is an unsafe replacement for a function call: use this
     * function instead.
     *
     * If `target` reverts with a revert reason or custom error, it is bubbled
     * up by this function (like regular Solidity function calls). However, if
     * the call reverted with no returned reason, this function reverts with a
     * {FailedInnerCall} error.
     *
     * Returns the raw returned data. To convert to the expected return value,
     * use https://solidity.readthedocs.io/en/latest/units-and-global-variables.html?highlight=abi.decode#abi-encoding-and-decoding-functions[`abi.decode`].
     *
     * Requirements:
     *
     * - `target` must be a contract.
     * - calling `target` with `data` must not revert.
     */
    function functionCall(address target, bytes memory data) internal returns (bytes memory) {
        return functionCallWithValue(target, data, 0);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but also transferring `value` wei to `target`.
     *
     * Requirements:
     *
     * - the calling contract must have an ETH balance of at least `value`.
     * - the called Solidity function must be `payable`.
     */
    function functionCallWithValue(address target, bytes memory data, uint256 value) internal returns (bytes memory) {
        if (address(this).balance < value) {
            revert AddressInsufficientBalance(address(this));
        }
        (bool success, bytes memory returndata) = target.call{value: value}(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but performing a static call.
     */
    function functionStaticCall(address target, bytes memory data) internal view returns (bytes memory) {
        (bool success, bytes memory returndata) = target.staticcall(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but performing a delegate call.
     */
    function functionDelegateCall(address target, bytes memory data) internal returns (bytes memory) {
        (bool success, bytes memory returndata) = target.delegatecall(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    /**
     * @dev Tool to verify that a low level call to smart-contract was successful, and reverts if the target
     * was not a contract or bubbling up the revert reason (falling back to {FailedInnerCall}) in case of an
     * unsuccessful call.
     */
    function verifyCallResultFromTarget(
        address target,
        bool success,
        bytes memory returndata
    ) internal view returns (bytes memory) {
        if (!success) {
            _revert(returndata);
        } else {
            // only check if target is a contract if the call was successful and the return data is empty
            // otherwise we already know that it was a contract
            if (returndata.length == 0 && target.code.length == 0) {
                revert AddressEmptyCode(target);
            }
            return returndata;
        }
    }

    /**
     * @dev Tool to verify that a low level call was successful, and reverts if it wasn't, either by bubbling the
     * revert reason or with a default {FailedInnerCall} error.
     */
    function verifyCallResult(bool success, bytes memory returndata) internal pure returns (bytes memory) {
        if (!success) {
            _revert(returndata);
        } else {
            return returndata;
        }
    }

    /**
     * @dev Reverts with returndata if present. Otherwise reverts with {FailedInnerCall}.
     */
    function _revert(bytes memory returndata) private pure {
        // Look for revert reason and bubble it up if present
        if (returndata.length > 0) {
            // The easiest way to bubble the revert reason is using memory via assembly
            /// @solidity memory-safe-assembly
            assembly {
                let returndata_size := mload(returndata)
                revert(add(32, returndata), returndata_size)
            }
        } else {
            revert FailedInnerCall();
        }
    }
}

// File: @openzeppelin/contracts@5.0.2/token/ERC20/utils/SafeERC20.sol
// OpenZeppelin Contracts (last updated v5.0.0) (token/ERC20/utils/SafeERC20.sol)

pragma solidity ^0.8.20;




/**
 * @title SafeERC20
 * @dev Wrappers around ERC20 operations that throw on failure (when the token
 * contract returns false). Tokens that return no value (and instead revert or
 * throw on failure) are also supported, non-reverting calls are assumed to be
 * successful.
 * To use this library you can add a `using SafeERC20 for IERC20;` statement to your contract,
 * which allows you to call the safe operations as `token.safeTransfer(...)`, etc.
 */
library SafeERC20 {
    using Address for address;

    /**
     * @dev An operation with an ERC20 token failed.
     */
    error SafeERC20FailedOperation(address token);

    /**
     * @dev Indicates a failed `decreaseAllowance` request.
     */
    error SafeERC20FailedDecreaseAllowance(address spender, uint256 currentAllowance, uint256 requestedDecrease);

    /**
     * @dev Transfer `value` amount of `token` from the calling contract to `to`. If `token` returns no value,
     * non-reverting calls are assumed to be successful.
     */
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        _callOptionalReturn(token, abi.encodeCall(token.transfer, (to, value)));
    }

    /**
     * @dev Transfer `value` amount of `token` from `from` to `to`, spending the approval given by `from` to the
     * calling contract. If `token` returns no value, non-reverting calls are assumed to be successful.
     */
    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        _callOptionalReturn(token, abi.encodeCall(token.transferFrom, (from, to, value)));
    }

    /**
     * @dev Increase the calling contract's allowance toward `spender` by `value`. If `token` returns no value,
     * non-reverting calls are assumed to be successful.
     */
    function safeIncreaseAllowance(IERC20 token, address spender, uint256 value) internal {
        uint256 oldAllowance = token.allowance(address(this), spender);
        forceApprove(token, spender, oldAllowance + value);
    }

    /**
     * @dev Decrease the calling contract's allowance toward `spender` by `requestedDecrease`. If `token` returns no
     * value, non-reverting calls are assumed to be successful.
     */
    function safeDecreaseAllowance(IERC20 token, address spender, uint256 requestedDecrease) internal {
        unchecked {
            uint256 currentAllowance = token.allowance(address(this), spender);
            if (currentAllowance < requestedDecrease) {
                revert SafeERC20FailedDecreaseAllowance(spender, currentAllowance, requestedDecrease);
            }
            forceApprove(token, spender, currentAllowance - requestedDecrease);
        }
    }

    /**
     * @dev Set the calling contract's allowance toward `spender` to `value`. If `token` returns no value,
     * non-reverting calls are assumed to be successful. Meant to be used with tokens that require the approval
     * to be set to zero before setting it to a non-zero value, such as USDT.
     */
    function forceApprove(IERC20 token, address spender, uint256 value) internal {
        bytes memory approvalCall = abi.encodeCall(token.approve, (spender, value));

        if (!_callOptionalReturnBool(token, approvalCall)) {
            _callOptionalReturn(token, abi.encodeCall(token.approve, (spender, 0)));
            _callOptionalReturn(token, approvalCall);
        }
    }

    /**
     * @dev Imitates a Solidity high-level call (i.e. a regular function call to a contract), relaxing the requirement
     * on the return value: the return value is optional (but if data is returned, it must not be false).
     * @param token The token targeted by the call.
     * @param data The call data (encoded using abi.encode or one of its variants).
     */
    function _callOptionalReturn(IERC20 token, bytes memory data) private {
        // We need to perform a low level call here, to bypass Solidity's return data size checking mechanism, since
        // we're implementing it ourselves. We use {Address-functionCall} to perform this call, which verifies that
        // the target address contains contract code and also asserts for success in the low-level call.

        bytes memory returndata = address(token).functionCall(data);
        if (returndata.length != 0 && !abi.decode(returndata, (bool))) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Imitates a Solidity high-level call (i.e. a regular function call to a contract), relaxing the requirement
     * on the return value: the return value is optional (but if data is returned, it must not be false).
     * @param token The token targeted by the call.
     * @param data The call data (encoded using abi.encode or one of its variants).
     *
     * This is a variant of {_callOptionalReturn} that silents catches all reverts and returns a bool instead.
     */
    function _callOptionalReturnBool(IERC20 token, bytes memory data) private returns (bool) {
        // We need to perform a low level call here, to bypass Solidity's return data size checking mechanism, since
        // we're implementing it ourselves. We cannot use {Address-functionCall} here since this should return false
        // and not revert is the subcall reverts.

        (bool success, bytes memory returndata) = address(token).call(data);
        return success && (returndata.length == 0 || abi.decode(returndata, (bool))) && address(token).code.length > 0;
    }
}

// File: NodalRouter.sol
// Pinned to an exact patch, not a floating ^0.8.20 range: some early 0.8.20.x
// patches have known compiler bugs (see Slither's solc-version detector / the
// Solidity bugs list). Pinning guarantees whoever compiles this gets the same
// bytecode we tested, on a patch without those known issues.
pragma solidity 0.8.24;

/**
 * NodalRouter
 * ============================================================================
 * Aggregator/router contract for Nodal, built for BlockDAG (chain ID 1404).
 *
 * READ BEFORE DEPLOYING
 * ----------------------------------------------------------------------------
 * 1. This assumes every registered DEX exposes a Uniswap V2-style router
 *    interface: getAmountsOut / swapExactTokensForTokens /
 *    swapExactETHForTokens / swapExactTokensForETH. Confirm each DEX's actual
 *    router ABI before registering it. If a source uses a different
 *    interface (V3-style concentrated liquidity, a custom AMM, etc.), quoting and swapping against that source will revert
 *    until this contract is adapted to match it.
 *
 * 2. No router or token addresses are hardcoded anywhere in this file. Once
 *    deployed, register each DEX's real router address yourself with
 *    registerSource() — take those addresses from each DEX's own official
 *    docs/deployment records, not guessed from an explorer.
 *
 * 3. This contract has NOT been audited. Do not point it at real user funds
 *    until it has been reviewed by a third party.
 *
 * 4. Ownership is a single key (OpenZeppelin Ownable). The owner can change
 *    the fee (bounded by MAX_FEE_BPS) and the treasury address. Before real
 *    usage, transfer ownership to a multisig or timelock rather than leaving
 *    it on one EOA.
 *
 * 5. Native BDAG swaps (swapExactBDAGForTokens / swapExactTokensForBDAG)
 *    assume the target DEX router wraps native BDAG the same way Uniswap V2
 *    routers wrap ETH — i.e. path[0] or path[last] must be that DEX's
 *    wrapped-native token address. The frontend is responsible for building
 *    that path correctly; this contract just forwards it.
 * ============================================================================
 */






interface IDexRouter {
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts);

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

contract NodalRouter is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    /// @notice Hard ceiling on the routing fee. The owner can never set feeBps above this,
    /// no matter what — this bound is not itself owner-adjustable.
    uint16 public constant MAX_FEE_BPS = 100; // 1.00%

    /// @notice Current routing fee in basis points (100 = 1.00%). Starts at 0.15%.
    uint16 public feeBps = 15;

    /// @notice Address that receives the routing fee on every swap.
    address public treasury;

    /// @notice Optional per-token cap on amountIn for a single swap, in that token's own
    /// smallest unit. 0 = no cap set for that token (the default — unrestricted). This is
    /// deliberately NOT a dollar-value cap: the contract has no price oracle by design (same
    /// reasoning as keeping quoting oracle-free elsewhere), so "cap deposits at $500" has to
    /// be approximated per-token by the owner rather than enforced automatically in USD terms.
    /// address(0) is used as the key for native BDAG's cap.
    mapping(address => uint256) public maxAmountIn;

    event MaxAmountInUpdated(address indexed token, uint256 oldCap, uint256 newCap);

    struct Source {
        address router;
        string name;
        bool active;
    }

    mapping(bytes32 => Source) public sources;
    bytes32[] public sourceIds;

    event SourceRegistered(bytes32 indexed id, address router, string name);
    event SourceStatusChanged(bytes32 indexed id, bool active);
    event FeeUpdated(uint16 oldFeeBps, uint16 newFeeBps);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event Rescued(address indexed token, address indexed to, uint256 amount);
    event SwapExecuted(
        address indexed user,
        bytes32 indexed sourceId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 grossAmountOut,
        uint256 fee,
        uint256 netAmountOut
    );

    constructor(address _treasury) Ownable(msg.sender) {
        require(_treasury != address(0), "treasury=0");
        treasury = _treasury;
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    /// @notice Register (or update) a liquidity source. `id` is any stable identifier
    /// you choose off-chain, e.g. keccak256("blockdag-native-swap").
    function registerSource(bytes32 id, address router, string calldata name) external onlyOwner {
        require(router != address(0), "router=0");
        if (sources[id].router == address(0)) {
            sourceIds.push(id);
        }
        sources[id] = Source(router, name, true);
        emit SourceRegistered(id, router, name);
    }

    function setSourceActive(bytes32 id, bool active) external onlyOwner {
        require(sources[id].router != address(0), "unknown source");
        sources[id].active = active;
        emit SourceStatusChanged(id, active);
    }

    function setFeeBps(uint16 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_FEE_BPS, "fee too high");
        emit FeeUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "treasury=0");
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    /// @notice Emergency stop: blocks all new swaps (quoting still works — quoteAll/quote
    /// stay callable while paused, since they're read-only and useful for monitoring).
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Set a per-transaction cap on how much of `token` can be swapped in at once.
    /// Pass address(0) to cap native BDAG. 0 = uncapped for that token.
    function setMaxAmountIn(address token, uint256 newCap) external onlyOwner {
        emit MaxAmountInUpdated(token, maxAmountIn[token], newCap);
        maxAmountIn[token] = newCap;
    }

    function allSourceIds() external view returns (bytes32[] memory) {
        return sourceIds;
    }

    // ------------------------------------------------------------------
    // Quoting (view-only, no gas to call off-chain)
    // ------------------------------------------------------------------

    /// @notice Quote a single source.
    function quote(bytes32 sourceId, uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256 grossOut, uint256 fee, uint256 netOut)
    {
        Source memory s = sources[sourceId];
        require(s.router != address(0) && s.active, "source unavailable");
        uint256[] memory amounts = IDexRouter(s.router).getAmountsOut(amountIn, path);
        grossOut = amounts[amounts.length - 1];
        fee = (grossOut * feeBps) / 10000;
        netOut = grossOut - fee;
    }

    /// @notice Quote every registered source in one call, so a frontend can rank them
    /// without firing off one RPC call per source. Sources that revert (no pool for this
    /// path, paused, etc.) come back as zero rather than reverting the whole call.
    function quoteAll(uint256 amountIn, address[] calldata path)
        external
        view
        returns (bytes32[] memory ids, uint256[] memory grossOuts, uint256[] memory fees, uint256[] memory netOuts)
    {
        uint256 n = sourceIds.length;
        ids = new bytes32[](n);
        grossOuts = new uint256[](n);
        fees = new uint256[](n);
        netOuts = new uint256[](n);

        for (uint256 i = 0; i < n; i++) {
            bytes32 id = sourceIds[i];
            ids[i] = id;
            Source memory s = sources[id];
            if (!s.active) continue;

            // Reviewed: this is a view function called off-chain for quoting, not a
            // state-changing transaction — an external call per source here costs no
            // gas to the caller and carries none of the reentrancy/DoS risk the
            // calls-loop detector is meant to catch in transactional code.
            // slither-disable-next-line calls-loop
            try IDexRouter(s.router).getAmountsOut(amountIn, path) returns (uint256[] memory amounts) {
                uint256 gross = amounts[amounts.length - 1];
                uint256 fee = (gross * feeBps) / 10000;
                grossOuts[i] = gross;
                fees[i] = fee;
                netOuts[i] = gross - fee;
            } catch {
                // leave as zero — this source can't quote this path right now
            }
        }
    }

    // ------------------------------------------------------------------
    // Swapping
    // ------------------------------------------------------------------

    /// @dev Reverts if `amountIn` exceeds the configured cap for `token` (address(0) = native
    /// BDAG). A cap of 0 means uncapped, matching setMaxAmountIn's documented semantics.
    function _enforceCap(address token, uint256 amountIn) private view {
        uint256 cap = maxAmountIn[token];
        require(cap == 0 || amountIn <= cap, "exceeds per-tx cap");
    }

    /// @notice ERC20 -> ERC20 swap routed through a specific registered source.
    /// Caller must have approved this contract for `amountIn` of path[0] beforehand.
    function swapExactTokensForTokens(
        bytes32 sourceId,
        uint256 amountIn,
        uint256 minNetAmountOut,
        address[] calldata path,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256 netAmountOut) {
        Source memory s = sources[sourceId];
        require(s.router != address(0) && s.active, "source unavailable");
        require(path.length >= 2, "bad path");

        address tokenIn = path[0];
        address tokenOut = path[path.length - 1];
        _enforceCap(tokenIn, amountIn);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(s.router, amountIn);

        uint256 balBefore = IERC20(tokenOut).balanceOf(address(this));
        // Reviewed: output is measured by balance delta, not the router's returned
        // amounts array — deliberately, since balance diffing is safe even against a
        // router that returns an incorrect amounts array, whereas trusting the
        // return value directly would not be.
        // slither-disable-next-line unused-return
        IDexRouter(s.router).swapExactTokensForTokens(amountIn, 0, path, address(this), deadline);
        uint256 grossAmountOut = IERC20(tokenOut).balanceOf(address(this)) - balBefore;

        netAmountOut = _settleTokenOut(sourceId, tokenIn, tokenOut, amountIn, grossAmountOut, minNetAmountOut);
    }

    /// @notice Native BDAG -> ERC20. Send BDAG as msg.value. `path[0]` must be the
    /// target DEX's wrapped-native token address (its own WETH-equivalent).
    function swapExactBDAGForTokens(
        bytes32 sourceId,
        uint256 minNetAmountOut,
        address[] calldata path,
        uint256 deadline
    ) external payable nonReentrant whenNotPaused returns (uint256 netAmountOut) {
        Source memory s = sources[sourceId];
        require(s.router != address(0) && s.active, "source unavailable");
        require(msg.value > 0, "no value sent");
        require(path.length >= 2, "bad path");
        _enforceCap(address(0), msg.value);

        address tokenOut = path[path.length - 1];

        uint256 balBefore = IERC20(tokenOut).balanceOf(address(this));
        // Reviewed: see the matching note in swapExactTokensForTokens — balance-diff
        // by design, not an oversight.
        // slither-disable-next-line unused-return
        IDexRouter(s.router).swapExactETHForTokens{value: msg.value}(0, path, address(this), deadline);
        uint256 grossAmountOut = IERC20(tokenOut).balanceOf(address(this)) - balBefore;

        netAmountOut = _settleTokenOut(sourceId, address(0), tokenOut, msg.value, grossAmountOut, minNetAmountOut);
    }

    /// @notice ERC20 -> native BDAG. `path[last]` must be the target DEX's
    /// wrapped-native token address.
    function swapExactTokensForBDAG(
        bytes32 sourceId,
        uint256 amountIn,
        uint256 minNetAmountOut,
        address[] calldata path,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256 netAmountOut) {
        Source memory s = sources[sourceId];
        require(s.router != address(0) && s.active, "source unavailable");
        require(path.length >= 2, "bad path");

        address tokenIn = path[0];
        _enforceCap(tokenIn, amountIn);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(s.router, amountIn);

        uint256 balBefore = address(this).balance;
        // Reviewed: see the matching note in swapExactTokensForTokens — balance-diff
        // by design, not an oversight.
        // slither-disable-next-line unused-return
        IDexRouter(s.router).swapExactTokensForETH(amountIn, 0, path, address(this), deadline);
        uint256 grossAmountOut = address(this).balance - balBefore;

        netAmountOut = _settleNativeOut(sourceId, tokenIn, amountIn, grossAmountOut, minNetAmountOut);
    }

    /// @dev Shared settlement for swaps whose output is an ERC20 token: computes the fee,
    /// pays the treasury and the user, and emits the event. Pulled out of the swap
    /// functions themselves to keep their local-variable count low enough for the
    /// default (non-IR) Solidity codegen — inlining this logic back into the callers
    /// reintroduces a "stack too deep" compile error.
    function _settleTokenOut(
        bytes32 sourceId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 grossAmountOut,
        uint256 minNetAmountOut
    ) private returns (uint256 netAmountOut) {
        uint256 fee = (grossAmountOut * feeBps) / 10000;
        netAmountOut = grossAmountOut - fee;
        require(netAmountOut >= minNetAmountOut, "slippage");

        if (fee > 0) IERC20(tokenOut).safeTransfer(treasury, fee);
        IERC20(tokenOut).safeTransfer(msg.sender, netAmountOut);

        emit SwapExecuted(msg.sender, sourceId, tokenIn, tokenOut, amountIn, grossAmountOut, fee, netAmountOut);
    }

    /// @dev Shared settlement for swaps whose output is native BDAG. See _settleTokenOut.
    function _settleNativeOut(
        bytes32 sourceId,
        address tokenIn,
        uint256 amountIn,
        uint256 grossAmountOut,
        uint256 minNetAmountOut
    ) private returns (uint256 netAmountOut) {
        uint256 fee = (grossAmountOut * feeBps) / 10000;
        netAmountOut = grossAmountOut - fee;
        require(netAmountOut >= minNetAmountOut, "slippage");

        if (fee > 0) {
            // Reviewed: `treasury` is an owner-set contract address, not caller-controlled.
            // slither-disable-next-line arbitrary-send-eth
            (bool sentFee, ) = payable(treasury).call{value: fee}("");
            require(sentFee, "fee transfer failed");
        }
        // Reviewed: paying msg.sender their own trade proceeds, not an arbitrary address.
        // slither-disable-next-line arbitrary-send-eth
        (bool sentUser, ) = payable(msg.sender).call{value: netAmountOut}("");
        require(sentUser, "payout failed");

        emit SwapExecuted(msg.sender, sourceId, tokenIn, address(0), amountIn, grossAmountOut, fee, netAmountOut);
    }

    // ------------------------------------------------------------------
    // Safety / rescue
    // ------------------------------------------------------------------

    /// @dev Accepts plain BDAG transfers (e.g. leftover dust from a swap).
    receive() external payable {}

    /// @notice Owner-only rescue for tokens mistakenly sent directly to this contract
    /// (not funds mid-swap — those never rest here longer than one transaction).
    /// Emits an event so any use of this is publicly auditable on-chain.
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "to=0");
        emit Rescued(token, to, amount);
        IERC20(token).safeTransfer(to, amount);
    }

    function rescueBDAG(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "to=0");
        emit Rescued(address(0), to, amount);
        // Reviewed: `to` is an owner-supplied argument (onlyOwner-gated), not
        // attacker-controlled input, so this is not an arbitrary-recipient send.
        // slither-disable-next-line arbitrary-send-eth,low-level-calls
        (bool sent, ) = payable(to).call{value: amount}("");
        require(sent, "rescue failed");
    }
}
