cmake_minimum_required(VERSION 3.14)
project(CoreVerCap3)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
include(FetchContent)

# ── Static linking (single statically linked binary) ──────────────────────
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
if(MSVC)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
else()
    set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -static -static-libgcc -static-libstdc++")
endif()

# ── Threads (pthread on Linux/macOS) ──────────────────────────────────────
set(THREADS_PREFER_PTHREAD_FLAG ON)
find_package(Threads REQUIRED)

# ── nlohmann/json ─────────────────────────────────────────────────────────
FetchContent_Declare(
    nlohmann_json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG        v3.11.3
)
FetchContent_MakeAvailable(nlohmann_json)

# ── ZLIB (Auto-downloaded) ────────────────────────────────────────────────
set(ZLIB_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
FetchContent_Declare(
    zlib
    GIT_REPOSITORY https://github.com/madler/zlib.git
    GIT_TAG        v1.3.1
)
FetchContent_MakeAvailable(zlib)

# ── SQLite3 amalgamation (self-contained, no system dependency) ───────────
set(SQLITE3_DIR "${CMAKE_BINARY_DIR}/sqlite3-src")
if(NOT DEFINED SQLITE3_URL)
    set(SQLITE3_URL "https://www.sqlite.org/2024/sqlite-amalgamation-3460100.zip")
endif()
if(NOT EXISTS "${SQLITE3_DIR}/sqlite3.c")
    message(STATUS "Downloading SQLite3 amalgamation...")
    file(DOWNLOAD ${SQLITE3_URL}
         "${CMAKE_BINARY_DIR}/sqlite3.zip"
         STATUS DL_STATUS)
    list(GET DL_STATUS 0 DL_ERROR)
    if(DL_ERROR)
        message(FATAL_ERROR "Failed to download SQLite3: ${DL_STATUS}")
    endif()
    file(ARCHIVE_EXTRACT INPUT "${CMAKE_BINARY_DIR}/sqlite3.zip"
         DESTINATION "${SQLITE3_DIR}")
    file(REMOVE "${CMAKE_BINARY_DIR}/sqlite3.zip")
endif()
file(GLOB SQLITE3_SUBDIR "${SQLITE3_DIR}/sqlite-amalgamation-*")
if(NOT SQLITE3_SUBDIR)
    message(FATAL_ERROR "SQLite3 amalgamation directory not found")
endif()
add_library(sqlite3 STATIC "${SQLITE3_SUBDIR}/sqlite3.c")
target_include_directories(sqlite3 PUBLIC "${SQLITE3_SUBDIR}")
if(UNIX)
    target_link_libraries(sqlite3 PUBLIC dl)
endif()

# ── curl + OpenSSL (statically linked, GSSAPI/Kerberos disabled) ──────────
# System libcurl on Ubuntu is built with GSSAPI support, and pkg-config
# --static then demands -lgssapi_krb5/-lkrb5/-lk5crypto — but Ubuntu only
# ships those as .so, never as .a, so a fully static link against system
# curl is impossible without compiling MIT krb5 from source yourself.
# Instead of depending on system curl at all, curl is built from source
# here via FetchContent with GSSAPI explicitly OFF, so the missing-symbol
# problem never arises and the resulting binary stays 100% statically
# linked. OpenSSL is still taken from the system (libssl-dev), since
# building OpenSSL from source is its own can of worms and Ubuntu DOES
# ship libssl.a/libcrypto.a statically.
if(UNIX AND NOT APPLE)
    find_package(OpenSSL REQUIRED)

    set(BUILD_CURL_EXE OFF CACHE BOOL "" FORCE)
    set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
    set(CURL_USE_OPENSSL ON CACHE BOOL "" FORCE)
    set(CURL_USE_LIBSSH2 OFF CACHE BOOL "" FORCE)
    set(CURL_USE_LIBPSL OFF CACHE BOOL "" FORCE)
    set(USE_NGHTTP2 OFF CACHE BOOL "" FORCE)
    set(CURL_USE_GSSAPI OFF CACHE BOOL "" FORCE)
    set(CURL_DISABLE_LDAP ON CACHE BOOL "" FORCE)
    set(CURL_DISABLE_LDAPS ON CACHE BOOL "" FORCE)
    set(CURL_DISABLE_RTSP ON CACHE BOOL "" FORCE)
    set(USE_LIBRTMP OFF CACHE BOOL "" FORCE)
    set(CURL_ZLIB ON CACHE BOOL "" FORCE)
    set(ENABLE_UNIX_SOCKETS OFF CACHE BOOL "" FORCE)
    set(CURL_DISABLE_TESTS ON CACHE BOOL "" FORCE)

    FetchContent_Declare(
        curl
        GIT_REPOSITORY https://github.com/curl/curl.git
        GIT_TAG        curl-8_10_1
    )
    FetchContent_MakeAvailable(curl)
elseif(WIN32)
    set(BUILD_CURL_EXE OFF CACHE BOOL "" FORCE)
    set(CURL_USE_SCHANNEL ON CACHE BOOL "" FORCE)   # Windows native TLS — no OpenSSL needed
    set(CURL_USE_OPENSSL OFF CACHE BOOL "" FORCE)
    set(CURL_USE_LIBSSH2 OFF CACHE BOOL "" FORCE)
    set(CURL_USE_LIBPSL OFF CACHE BOOL "" FORCE)
    set(USE_NGHTTP2 OFF CACHE BOOL "" FORCE)
    set(CURL_DISABLE_LDAP ON CACHE BOOL "" FORCE)
    set(CURL_DISABLE_LDAPS ON CACHE BOOL "" FORCE)
    set(CURL_ZLIB ON CACHE BOOL "" FORCE)
    set(CURL_DISABLE_TESTS ON CACHE BOOL "" FORCE)
    set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)

    FetchContent_Declare(
        curl
        GIT_REPOSITORY https://github.com/curl/curl.git
        GIT_TAG        curl-8_10_1
    )
    FetchContent_MakeAvailable(curl)
else()
    find_package(CURL REQUIRED)
    find_package(OpenSSL REQUIRED)
endif()

# ── Main executable ───────────────────────────────────────────────────────
add_executable(main main.cpp)
# Expose the fetched ZLIB headers to main.cpp
target_include_directories(main PRIVATE ${zlib_SOURCE_DIR} ${zlib_BINARY_DIR})
target_link_libraries(main
    nlohmann_json::nlohmann_json
    sqlite3
    zlibstatic          # The statically built target from FetchContent
    Threads::Threads
)

if(UNIX AND NOT APPLE)
    target_link_libraries(main libcurl OpenSSL::SSL OpenSSL::Crypto dl)
elseif(WIN32)
    target_link_libraries(main libcurl ws2_32 crypt32 bcrypt)
else()
    target_link_libraries(main CURL::libcurl OpenSSL::SSL OpenSSL::Crypto)
endif()
