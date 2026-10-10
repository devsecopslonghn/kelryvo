SCHEMAFORGE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:32768/schemaforge_tests SCHEMAFORGE_REQUIRE_PRODUCT_TESTS=1 taskset -c 0,1 npm run check
