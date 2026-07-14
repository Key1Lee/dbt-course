{{ config(materialized='table', tags=['apple_pay']) }}

WITH devices AS (
    SELECT *
    FROM {{ ref('stg_apple_pay_devices') }}
)

SELECT
    device_id,
    customer_id,
    device_type,
    os_version,
    wallet_enrolled_at
FROM devices
