// The identity seed as the iPhone app keeps it in iCloud Keychain (GRYT-1881): the same service,
// account and access group as mobile's modules/synced-seed, so a Mac signed into the same Apple ID reads it.
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <node_api.h>

static NSString *const kService = @"chat.gryt.identity";
static NSString *const kAccount = @"seed";
static NSString *const kGroup = @"8883W2XTQ8.chat.gryt.app";

static NSMutableDictionary *Query() {
  return [@{
    (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService: kService,
    (__bridge id)kSecAttrAccount: kAccount,
    (__bridge id)kSecAttrAccessGroup: kGroup,
    (__bridge id)kSecAttrSynchronizable: @YES,
    (__bridge id)kSecUseDataProtectionKeychain: @YES,
  } mutableCopy];
}

// Null when there's none, or when this build isn't entitled to the group (an unsigned dev build).
static napi_value Read(napi_env env, napi_callback_info info) {
  NSMutableDictionary *q = Query();
  q[(__bridge id)kSecReturnData] = @YES;
  q[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
  CFTypeRef item = NULL;
  napi_value out;
  if (SecItemCopyMatching((__bridge CFDictionaryRef)q, &item) != errSecSuccess || !item) {
    napi_get_null(env, &out);
    return out;
  }
  NSString *s = [[NSString alloc] initWithData:(__bridge_transfer NSData *)item encoding:NSUTF8StringEncoding];
  if (!s) {
    napi_get_null(env, &out);
    return out;
  }
  napi_create_string_utf8(env, s.UTF8String, NAPI_AUTO_LENGTH, &out);
  return out;
}

static napi_value Write(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  char buf[256];
  size_t len = 0;
  napi_value out;
  if (argc < 1 || napi_get_value_string_utf8(env, argv[0], buf, sizeof buf, &len) != napi_ok || len == 0) {
    napi_get_boolean(env, false, &out);
    return out;
  }
  NSData *data = [NSData dataWithBytes:buf length:len];
  NSDictionary *attrs = @{
    (__bridge id)kSecValueData: data,
    (__bridge id)kSecAttrAccessible: (__bridge id)kSecAttrAccessibleAfterFirstUnlock,
  };
  OSStatus updated = SecItemUpdate((__bridge CFDictionaryRef)Query(), (__bridge CFDictionaryRef)attrs);
  bool ok = updated == errSecSuccess;
  if (updated == errSecItemNotFound) {
    NSMutableDictionary *add = Query();
    [add addEntriesFromDictionary:attrs];
    ok = SecItemAdd((__bridge CFDictionaryRef)add, NULL) == errSecSuccess;
  }
  napi_get_boolean(env, ok, &out);
  return out;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
    {"read", NULL, Read, NULL, NULL, NULL, napi_default, NULL},
    {"write", NULL, Write, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, 2, props);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
