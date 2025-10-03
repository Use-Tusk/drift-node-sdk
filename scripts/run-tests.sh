dockerup() {
        docker compose -f docker-compose.test.yml up -d --wait
}

dockerdown() {
        docker compose -f docker-compose.test.yml down
}

code=0
command="$1"
shift

case "$command" in
        up)
                dockerup
                ;;
        down)
                dockerdown
                ;;
        int)
                dockerup
                npx jest --testMatch "**/*.test.int.ts" "$@" || code=$?
                dockerdown
                ;;
        unit)
                npx jest --testMatch "**/*.test.ts" "$@" || code=$?
                ;;
        *)
                dockerup
                npx jest "$@" || code=$?
                dockerdown
                ;;
esac

exit $code
