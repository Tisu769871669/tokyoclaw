# Snowchuang Ordering API Reference

Base URL:

```text
https://mall.xuechuang.biz/app-api/mcp/api-mcp
```

Authentication:

- Method: HTTP GET
- Headers: `mcpKey`, `mcpSecret`
- Use environment variables `XCDHT_MCP_KEY` and `XCDHT_MCP_SECRET`; do not store the secret in this skill.

## Member User List

Endpoint:

```text
GET /memberUserList
```

Query params:

- `pageNo` integer, required
- `pageSize` integer, required

Important response fields:

- `id`: user id
- `registerIp`: registration IP
- `loginIp`: last login IP
- `loginDate`: last login time
- `createTime`: created time
- `point`: current points
- `totalPoint`: total points
- `tagNames`: member tag names
- `levelName`: member level name
- `hyTime`: membership time
- `groupName`: user group
- `experience`: user experience value
- `shopAppname`: user mini-store name
- `shopAppid`: user mini-store app id
- `shopTenantId`: user mini-store tenant id
- `identity`: user identity
- `email`: email
- `businessLicense`: business license
- `businessLicenseStatus`: business license review status
- `referCode`: referral code
- `parentReferCode`: parent referral code
- `cardNum`: member card number
- `claimNum`: coupon claim count
- `claimPeriod`: coupon claim period; `2` means current week, `3` means current month

## Member User Order List

Endpoint:

```text
GET /memberUserOrderList
```

Query params:

- `pageNo` integer, required
- `pageSize` integer, required
- `userId` long, required

Order status mapping:

- `0`: 已预订-待确定
- `5`: 已确定-待付款
- `10`: 已付款-待采购
- `15`: 已采购
- `20`: 已发货
- `30`: 已完成
- `40`: 已取消

Important response fields:

- `id`: order id
- `no`: order serial number
- `createTime`: order created time
- `type`: order type
- `orderType`: order type
- `terminal`: order source terminal
- `userId`: user id
- `userIp`: user IP
- `userRemark`: user remark
- `status`: order status
- `statusFh`: exchange status
- `productCount`: product count
- `finishTime`: completion time
- `cancelTime`: cancellation time
- `cancelType`: cancellation type
- `remark`: merchant remark
- `payOrderId`: payment order id
- `payStatus`: whether paid
- `payTime`: payment time
- `payChannelCode`: payment channel
- `totalPrice`: total original product price
- `totalPriceH`: total original product price
- `discountPrice`: total order discount
- `deliveryPrice`: delivery fee
- `adjustPrice`: total manual adjustment
- `payPrice`: payable amount
- `payPriceH`: payable amount in fen
- `handlingBl`: buyer service fee percentage
- `handlingFee`: buyer service fee
- `handlingFeeH`: buyer service fee
- `deliveryType`: delivery type
- `pickUpStoreId`: pickup store id
- `pickUpVerifyCode`: pickup verification code
- `deliveryTemplateId`: delivery template id
- `logisticsId`: logistics company id
- `logisticsNo`: logistics tracking number
- `logisticsPhone`: phone used for logistics lookup
- `deliveryTime`: shipment time
- `receiveTime`: receipt time
- `receiverName`: receiver name
- `receiverMobile`: receiver mobile
- `receiverAreaId`: receiver area id
- `receiverDetailAddress`: receiver detailed address
- `afterSaleStatus`: after-sales status
- `refundStatus`: refund status
- `refundPrice`: refund amount
- `couponId`: coupon id
- `couponPrice`: coupon discount amount
- `pointPrice`: points deduction amount
- `vipPrice`: VIP discount amount
- `brokerageUserId`: promoter id
- `xdhj`: order environment
- `shareUid`: share user id
