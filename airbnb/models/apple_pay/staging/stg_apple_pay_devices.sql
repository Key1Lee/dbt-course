{{ config(materialized='view', tags=['apple_pay']) }}

WITH source_data AS (
    SELECT *
    FROM {{ ref('seed_apple_pay_devices') }}
)

SELECT
    TRIM(CAST(device_id AS VARCHAR))::VARCHAR(20) AS device_id,
    TRIM(CAST(customer_id AS VARCHAR))::VARCHAR(20) AS customer_id,
    LOWER(TRIM(CAST(device_type AS VARCHAR)))::VARCHAR(30) AS device_type,
    TRIM(CAST(os_version AS VARCHAR))::VARCHAR(20) AS os_version,
    CAST(wallet_enrolled_at AS TIMESTAMP_NTZ) AS wallet_enrolled_at
FROM source_data
