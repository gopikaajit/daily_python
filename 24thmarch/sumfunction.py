#function to find sum

def findsum(x, y):
    return(x+y)
def main():
    print("This is a program to find sum of two numbers by calling a user defined function!!")
    a=input("Enter first number=")
    b=input("Enter second number=")
    (num1,num2)=int(a), int(b)
    sum_result=findsum(num1,num2)
    print("tThe sum is =",sum_result)

main()